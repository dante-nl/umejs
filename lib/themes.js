const fs = require('fs');
const path = require('path');
const { createRequire } = require('node:module');

const builtinDefaults = {};

/**
 * Checks if the current version should be compatible with a theme.
 * @param {string} current Current version
 * @param {string} range The range of accepted versions in nodejs format (e.g. ^2.0.1; \@5.1.0)
 * @returns {boolean} Whether or not the current version is compatible in the range
 */
function satisfiesVersion(current, range) {
    if (!range || range === '*') return true;

    // Exact match
    if (current === range) return true;

    const parse = (/** @type {string} */ v) => v.split('.').map(Number);
    const [currMajor, currMinor, currPatch] = parse(current);

    if (range.startsWith('^')) {
        const [major, minor, patch] = parse(range.slice(1));
        if (currMajor !== major) return false;
        if (currMinor > minor) return true;
        if (currMinor === minor && currPatch >= patch) return true;
        return false;
    }

    if (range.startsWith('~')) {
        const [major, minor, patch] = parse(range.slice(1));
        if (currMajor !== major || currMinor !== minor) return false;
        return currPatch >= patch;
    }

    if (range.startsWith('>=')) {
        const [major, minor, patch] = parse(range.slice(2));
        return (
            currMajor > major ||
            (currMajor === major && currMinor > minor) ||
            (currMajor === major && currMinor === minor && currPatch >= patch)
        );
    }

    // if operator is unknown and no exact match, fail!
    return false;
}

/**
 * @param {{}[]} sources
 */
function deepMerge(...sources) {
    const out = {};
    for (const src of sources) {
        if (!src) continue;
        for (const k of Object.keys(src)) {
            const v = src[k];
            if (v && typeof v === 'object' && !Array.isArray(v)) {
                out[k] = deepMerge(out[k] || {}, v);
            } else {
                out[k] = v; // arrays and scalars replace
            }
        }
    }
    return out;
}

function getConsumerRequire() {
    // `require.main.filename` is the file Node was launched with (e.g. ume-demo/index.js)
    // `process.argv[1]` is a fallback for ESM contexts where `require.main` may be undefined.
    const entry = (require.main && require.main.filename) || process.argv[1];

    if (entry) {
        try {
            return createRequire(entry);
        } catch {
            /* fall through */
        }
    }

    // last resort: assume the consumer ran from their project root.
    return createRequire(path.join(process.cwd(), 'index.js'));
}

function loadThemes(specs = []) {
    // expand `extends` recursively, dedupe, preserve priority order
    const seen = new Set();
    const out = [];
    const consumerRequire = getConsumerRequire();

    // get umejs version
    const umejsVersion = require('../package.json').version;

    const visit = (/** @type {string} */ name) => {
        if (seen.has(name)) return;
        seen.add(name);

        let manifest = consumerRequire(name); // package main = manifest

        // when require()ing an ESM module from CJS, Node returns the module namespace object (`{ default: <manifest>, ... }`),
        // not the default export.
        // unwrap it so `.name`, `.entryTemplate`, etc. resolve.
        if (manifest && manifest[Symbol.toStringTag] === 'Module') {
            manifest = manifest.default ?? manifest;
        }

        if (manifest.umeVersion && !satisfiesVersion(umejsVersion, manifest.umeVersion)) {
            throw new Error(
                `Theme "${manifest.name || name}" requires umejs version ${manifest.umeVersion}, but you are using ${umejsVersion}.`,
            );
        }

        for (const parent of manifest.extends || []) visit(parent);
        out.push({ name, manifest, rootDir: path.dirname(consumerRequire.resolve(name)) });
    };
    for (const name of specs) visit(name);
    return out; // priority order: index 0 highest
}

/**
 * Build the merged theme context from user options and theme manifests.
 * @param {Object} options - The user provided ume options.
 * @param {string} options.contentDir - Path to the content directory.
 * @param {string} [options.templatePath] - Default template file path.
 * @param {Array<string>} [options.themes] - Theme package names or paths.
 * @param {Object} [options.config] - User configuration overrides.
 * @param {Record<string, Function|Object>} [options.helpers] - User helpers.
 * @param {Record<string, string>} [options.includes] - User inline includes.
 * @param {Array<Function>} [options.parsers] - User parsers.
 * @param {Array<Function>} [options.builders] - User builders.
 * @param {string} [options.templatesDir] - User templates directory.
 * @param {string} [options.partialsDir] - User partials directory.
 * @param {string} [options.assetsDir] - User assets directory.
 * @returns {Object} The resolved theme context.
 */
function buildContext(options) {
    const themes = loadThemes(options.themes || []);

    // priority: user > themes[0] > themes[1] > ...
    // merge lowest-priority first so later calls override.
    const reversed = themes.slice().reverse();

    const config = deepMerge(
        builtinDefaults,
        ...reversed.map((t) => t.manifest.config || {}),
        options.config || {},
    );

    const helpers = Object.assign(
        {},
        ...reversed.map((t) => t.manifest.helpers || {}),
        options.helpers || {},
    );

    const includes = Object.assign(
        {},
        ...reversed.map((t) => t.manifest.includes || {}),
        options.includes || {},
    );

    const parsers = [
        ...reversed.flatMap((t) => t.manifest.parsers || []),
        ...(options.parsers || []),
    ];

    const builders = [
        ...reversed.flatMap((t) => t.manifest.builders || []),
        ...(options.builders || []),
    ];

    // directory resolution chain (highest priority first)
    const templatesDirs = [
        options.templatesDir,
        ...themes.map((t) => t.manifest.templatesDir),
    ].filter(Boolean);
    const partialsDirs = [options.partialsDir, ...themes.map((t) => t.manifest.partialsDir)].filter(
        Boolean,
    );
    const assetsDirs = [options.assetsDir, ...themes.map((t) => t.manifest.assetsDir)].filter(
        Boolean,
    );

    const resolveIn = (
        /** @type {string[]} */ dirs,
        /** @type {string} */ name,
        /** @type {string[]} */ exts,
    ) => {
        // sanitize name to prevent directory traversal (strip leading ../)
        const safeName = name.replace(/^(\.\.[/\\])+/, '');

        const candidates = path.isAbsolute(safeName)
            ? [safeName]
            : dirs.map((/** @type {string} */ d) => path.join(d, safeName));

        for (const p of candidates) {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
            for (const ext of exts) {
                if (fs.existsSync(p + ext)) return p + ext;
            }
        }
        return null;
    };

    // determine default template (if any)
    let defaultTemplateName = null;

    for (const theme of themes) {
        if (theme.manifest.entryTemplate) {
            defaultTemplateName = theme.manifest.entryTemplate;
            break;
        }
    }

    const ctx = {
        themes,
        config,
        helpers,
        includes,
        parsers,
        builders,
        defaultTemplate: defaultTemplateName, // expose this for the builder
        resolveTemplate: (/** @type {any} */ templateName) => {
            // 1. if a specific name is requested (from frontmatter), resolve it
            if (templateName) {
                const p = resolveIn(templatesDirs, templateName, ['.ume.html', '.html']);
                if (p) return p;
                throw new Error(`Template not found: ${templateName}`);
            }

            // 2. user provided one
            if (options.templatePath) {
                return options.templatePath;
            }

            // 3. no frontmatter, or user defined one. use one defined by theme
            if (defaultTemplateName) {
                const p = resolveIn(templatesDirs, defaultTemplateName, ['.ume.html', '.html']);
                if (p) return p;
                throw new Error(
                    `Default template "${defaultTemplateName}" declared by theme not found.`,
                );
            }

            // 4. no default template could be determined.
            throw new Error(
                'No default template found. Please specify a templatePath, provide one via a theme or choose in frontmatter',
            );
        },
        resolvePartial: (/** @type {any} */ n) =>
            resolveIn(partialsDirs, n, ['.ume.html', '.html']),
        resolveAsset: (/** @type {any} */ n) => resolveIn(assetsDirs, n, []),
        templatesDirs,
        partialsDirs,
        assetsDirs,
    };

    // run setup() hooks in reverse priority (lowest first) so higher-priority themes override lower ones, then user options override themes.
    for (const t of reversed) {
        if (t.manifest.setup) {
            t.manifest.setup({
                config: ctx.config,
                themeRoot: t.rootDir,
                registerHelper: (/** @type {string | number} */ n, /** @type {any} */ f) => {
                    ctx.helpers[n] = f;
                },
                registerParser: (/** @type {any} */ f) => {
                    ctx.parsers.push(f);
                },
                registerBuilder: (/** @type {any} */ f) => {
                    ctx.builders.push(f);
                },
                registerInclude: (/** @type {string | number} */ n, /** @type {any} */ c) => {
                    ctx.includes[n] = c;
                },
                resolveTemplate: ctx.resolveTemplate,
                resolvePartial: ctx.resolvePartial,
            });
        }
    }

    // user inline options get final say
    Object.assign(ctx.helpers, options.helpers || {});
    Object.assign(ctx.includes, options.includes || {});
    ctx.parsers.push(...(options.parsers || []));
    ctx.builders.push(...(options.builders || []));

    return ctx;
}

module.exports = { buildContext, loadThemes, deepMerge, satisfiesVersion };
