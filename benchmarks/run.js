// benchmarks/run.js
//
// Per-scenario runner. Each scenario runs in its own child process with a
// clean V8 heap; the parent aggregates the results into a summary table.
//
// Usage:
//   node --expose-gc benchmarks/run.js
//   node --expose-gc benchmarks/run.js --scenario baseline   (single scenario)
//   node --expose-gc benchmarks/run.js 2>&1 | tee bench-results.txt

const express = require('express');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const v8 = require('node:v8');
const { generateFixtures } = require('./fixtures');
const ume = require('../index.js');
const { logWarn } = require('../lib/logger.js');

const N_WARMUP = 50;
const N_MEASURE = 1000;

if (typeof global.gc !== 'function') {
    process.stderr.write(
        'WARNING: --expose-gc not passed; memory measurements will be unreliable.\n',
    );
}

function forceGc() {
    if (typeof global.gc !== 'function') return;
    // two passes: first frees garbage, second settles external memory
    // (string backing stores, etc.) so heapUsed reflects what's actually retained
    global.gc();
    global.gc();
}

/**
 * Choose the slug for request `i` given a fixture set and a workload mode
 *   mixed       - uniform over simple/include/vars/large
 *   mixed-huge  - same, but 10% of requests hit huge-0
 *   huge-only   - every request hits huge-0
 *   simple-only - every request hits simple-0
 */
function pickSlug(i, counts, mode) {
    if (mode === 'huge-only') return 'huge-0';
    if (mode === 'simple-only') return 'simple-0';

    if (mode === 'mixed-huge' && counts.huge > 0 && i % 10 === 0) {
        return 'huge-0';
    }

    const base = counts.simple + counts.withIncludes + counts.withVariables + counts.large;
    const k = i % base;
    if (k < counts.simple) return `simple-${k}`;
    if (k < counts.simple + counts.withIncludes) return `include-${k - counts.simple}`;
    if (k < counts.simple + counts.withIncludes + counts.withVariables)
        return `vars-${k - counts.simple - counts.withIncludes}`;
    return `large-${k - counts.simple - counts.withIncludes - counts.withVariables}`;
}

async function measureScenario(name, config, fixtures) {
    const app = express();
    const middleware = ume({
        contentDir: fixtures.contentDir,
        templatePath: fixtures.templatePath,
        partialsDir: fixtures.partialsDir,
        quiet: true,
        cachePath: false,
        ...config.opts,
    });
    app.use('/{*slug}', middleware);

    const buildStart = performance.now();
    await middleware.ready;
    const buildMs = performance.now() - buildStart;

    // cache attribution
    const internals = middleware.internals;
    if (!internals) {
        logWarn('middleware.internals not present');
    }
    let htmlCacheBytes = 0;
    let htmlCacheEntries = null;
    if (internals?.cache instanceof Map) {
        for (const v of internals.cache.values()) {
            htmlCacheBytes += Buffer.byteLength(v, 'utf8');
        }
        htmlCacheEntries = internals.cache.size;
    }
    let astCacheBytes = 0;
    let astCacheEntries = null;
    if (internals?.astCache instanceof Map) {
        astCacheEntries = internals.astCache.size;
        if (astCacheEntries > 0) {
            astCacheBytes = v8.serialize(internals.astCache).length;
        }
    }

    forceGc();
    const memAfterBuild = process.memoryUsage();

    // start one long-lived server for whole measurement
    const server = app.listen(0);
    await new Promise((resolve) => server.on('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    // warmup
    for (let i = 0; i < N_WARMUP; i++) {
        const res = await fetch(`${baseUrl}/${pickSlug(i, fixtures.counts, config.mode)}`);
        await res.text();
    }

    forceGc();
    const memAfterWarmup = process.memoryUsage();

    const h = monitorEventLoopDelay({ resolution: 1 });
    h.enable();

    const nMeasure = config.nMeasure ?? N_MEASURE;
    let cpuUser = 0;
    let cpuSys = 0;
    let wallTotal = 0;

    for (let i = 0; i < nMeasure; i++) {
        const slug = pickSlug(i, fixtures.counts, config.mode);
        const cpu0 = process.cpuUsage();
        const t0 = performance.now();
        const res = await fetch(`${baseUrl}/${slug}`);
        await res.text(); // consume body so the connection is released
        const t1 = performance.now();
        const cpu1 = process.cpuUsage(cpu0);
        if (res.status !== 200) throw new Error(`Bad status ${res.status} for /${slug}`);
        cpuUser += cpu1.user;
        cpuSys += cpu1.system;
        wallTotal += t1 - t0;
        if (i > 0 && i % 100 === 0) {
            process.stderr.write(`  [${name}] ${i}/${nMeasure} requests\n`);
        }
    }

    h.disable();

    forceGc();
    const memAfterRequests = process.memoryUsage();

    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await middleware.close();

    return {
        name,
        mode: config.mode,
        nMeasure,
        buildMs: +buildMs.toFixed(2),
        heapAfterBuildMB: +(memAfterBuild.heapUsed / 1024 / 1024).toFixed(2),
        heapAfterWarmupMB: +(memAfterWarmup.heapUsed / 1024 / 1024).toFixed(2),
        heapAfterRequestsMB: +(memAfterRequests.heapUsed / 1024 / 1024).toFixed(2),
        heapDeltaPerRequestKB: +(
            (memAfterRequests.heapUsed - memAfterWarmup.heapUsed) /
            nMeasure /
            1024
        ).toFixed(3),
        cpuUserUsPerReq: +(cpuUser / nMeasure).toFixed(1),
        cpuSysUsPerReq: +(cpuSys / nMeasure).toFixed(1),
        wallUsPerReq: +((wallTotal / nMeasure) * 1000).toFixed(1),
        elDelayMeanMs: +(h.mean / 1e6).toFixed(3),
        elDelayP99Ms: +(h.percentile(99) / 1e6).toFixed(3),
        elDelayMaxMs: +(h.max / 1e6).toFixed(3),
        htmlCacheMB: +(htmlCacheBytes / 1024 / 1024).toFixed(2),
        htmlCacheEntries,
        astCacheApproxMB: +(astCacheBytes / 1024 / 1024).toFixed(2),
        astCacheEntries,
    };
}

// # scenario definitions.
// `fixtures` selects which fixture pages to generate:
// huge scenarios need huge:1, everything else uses huge:0 so the baseline doesn't pay build cost for a page it won't request.
const SCENARIOS = {
    baseline: {
        mode: 'mixed',
        fixtures: { huge: 0 },
        opts: {},
    },
    'simple-only': {
        mode: 'simple-only',
        fixtures: { huge: 0 },
        opts: {},
        nMeasure: 10000,
    },
    '1-realtime-helper': {
        mode: 'mixed',
        fixtures: { huge: 0 },
        opts: { helpers: { currentUser: { helper: () => 'Alice' } } },
    },
    '5-realtime-helpers': {
        mode: 'mixed',
        fixtures: { huge: 0 },
        opts: {
            helpers: Object.fromEntries(
                Array.from({ length: 5 }, (_, i) => [
                    `now${i}`,
                    { helper: () => String(Date.now()) },
                ]),
            ),
        },
    },
    '1-builder': {
        mode: 'mixed',
        fixtures: { huge: 0 },
        opts: { builders: [(req, res, slug, html) => html] },
    },
    'cached-helper': {
        mode: 'mixed',
        fixtures: { huge: 0 },
        opts: { helpers: { siteName: { helper: () => 'My Site', cache: true } } },
    },
    'mixed-with-huge': {
        mode: 'mixed-huge',
        fixtures: { huge: 1 },
        opts: {},
    },
    'huge-only': {
        mode: 'huge-only',
        fixtures: { huge: 1 },
        opts: {},
        // each request renders a multi-MB string, so 1000 iterations would take too long. 100 should be plenty for a stable per-request averag
        nMeasure: 100,
    },
};

async function runSingleScenario(name) {
    const config = SCENARIOS[name];
    if (!config) throw new Error(`Unknown scenario: ${name}`);
    const fixtures = generateFixtures(config.fixtures);
    try {
        const result = await measureScenario(name, config, fixtures);
        console.log(JSON.stringify(result));
    } finally {
        fixtures.cleanup();
    }
}

async function runAll() {
    const names = Object.keys(SCENARIOS);
    const results = [];

    for (const name of names) {
        const config = SCENARIOS[name];
        const env = { ...process.env, ...(config.env || {}) };
        process.stderr.write(`\n--- ${name} ---\n`);
        const raw = execFileSync(
            process.execPath,
            ['--expose-gc', __filename, '--scenario', name],
            {
                encoding: 'utf8',
                env,
                stdio: ['ignore', 'pipe', 'inherit'],
            },
        );
        const lastLine = raw.trim().split('\n').pop();
        let parsed;
        try {
            parsed = JSON.parse(lastLine);
        } catch (e) {
            process.stderr.write(`Failed to parse output for ${name}:\n${raw}\n`);
            throw e;
        }
        results.push(parsed);
        console.table([parsed]);
    }

    process.stderr.write('\n=== Summary ===\n');
    console.table(results);
}

const argIdx = process.argv.indexOf('--scenario');
if (argIdx !== -1) {
    const name = process.argv[argIdx + 1];
    runSingleScenario(name).catch((err) => {
        console.error(err);
        process.exit(1);
    });
} else {
    runAll().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
