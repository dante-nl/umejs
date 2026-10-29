const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { satisfiesVersion, deepMerge, loadThemes, buildContext } = require('../lib/themes');
const ume = require('../index');

// serialize a manifest object (including functions) into JS source
function serializeManifest(obj) {
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    const t = typeof obj;

    if (t === 'function') {
        const str = obj.toString();
        // If it's a method shorthand, prefix with "function "
        if (str.startsWith('function') || str.startsWith('(')) return str;
        return 'function ' + str;
    }
    if (t === 'string') return JSON.stringify(obj);
    if (t === 'number' || t === 'boolean') return String(obj);
    if (Array.isArray(obj)) return '[' + obj.map(serializeManifest).join(',') + ']';
    if (t === 'object') {
        const entries = Object.entries(obj).map(([k, v]) => {
            const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
            return `${key}: ${serializeManifest(v)}`;
        });
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(obj);
}

// create a theme on disk, `manifest` is a plain object and may contain functions.
// directory paths are auto-injected when the corresponding dirs are created.
async function makeTheme(tempDir, name, manifest = {}, opts = {}) {
    const dir = path.join(tempDir, name);
    await fs.mkdir(dir, { recursive: true });

    const m = { name, ...manifest };

    if (opts.templates !== false) {
        const tdir = path.join(dir, 'templates');
        await fs.mkdir(tdir, { recursive: true });
        await fs.writeFile(
            path.join(tdir, 'layout.ume.html'),
            opts.layoutHtml || '<html><body>{_BODY}</body></html>',
        );
        if (!m.templatesDir) m.templatesDir = tdir;
        if (!m.entryTemplate) m.entryTemplate = 'layout.ume.html';
    }
    if (opts.partials) {
        const pdir = path.join(dir, 'partials');
        await fs.mkdir(pdir, { recursive: true });
        for (const [pn, pc] of Object.entries(opts.partials)) {
            await fs.writeFile(path.join(pdir, pn), pc);
        }
        if (!m.partialsDir) m.partialsDir = pdir;
    }
    if (opts.assets) {
        const adir = path.join(dir, 'assets');
        await fs.mkdir(adir, { recursive: true });
        for (const [an, ac] of Object.entries(opts.assets)) {
            await fs.writeFile(path.join(adir, an), ac);
        }
        if (!m.assetsDir) m.assetsDir = adir;
    }

    await fs.writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify(opts.esm ? { type: 'module', main: 'index.js' } : { main: 'index.js' }),
    );

    const body = opts.esm
        ? `export default ${serializeManifest(m)};`
        : `module.exports = ${serializeManifest(m)};`;
    await fs.writeFile(path.join(dir, 'index.js'), body);

    return dir;
}

// # satisfiesVersion
test('satisfiesVersion', async (t) => {
    await t.test('exact match', () => {
        assert.equal(satisfiesVersion('1.2.3', '1.2.3'), true);
        assert.equal(satisfiesVersion('1.2.3', '1.2.4'), false);
    });

    await t.test('wildcard / undefined', () => {
        assert.equal(satisfiesVersion('1.2.3', '*'), true);
        assert.equal(satisfiesVersion('1.2.3', undefined), true);
        assert.equal(satisfiesVersion('1.2.3', null), true);
    });

    await t.test('caret ranges', () => {
        assert.equal(satisfiesVersion('1.2.3', '^1.0.0'), true);
        assert.equal(satisfiesVersion('1.2.3', '^1.2.3'), true);
        assert.equal(satisfiesVersion('1.2.3', '^1.3.0'), false);
        assert.equal(satisfiesVersion('1.2.3', '^2.0.0'), false);
        assert.equal(satisfiesVersion('2.0.0', '^1.0.0'), false);
    });

    await t.test('tilde ranges', () => {
        assert.equal(satisfiesVersion('1.2.3', '~1.2.0'), true);
        assert.equal(satisfiesVersion('1.2.3', '~1.3.0'), false);
        assert.equal(satisfiesVersion('1.3.0', '~1.2.0'), false);
    });

    await t.test('>= ranges', () => {
        assert.equal(satisfiesVersion('1.2.3', '>=1.0.0'), true);
        assert.equal(satisfiesVersion('1.2.3', '>=1.2.3'), true);
        assert.equal(satisfiesVersion('1.2.3', '>=1.2.4'), false);
        assert.equal(satisfiesVersion('2.0.0', '>=1.2.3'), true);
    });
});

// # deepMerge
test('deepMerge', async (t) => {
    await t.test('merges nested objects', () => {
        const result = deepMerge(
            { a: 1, nested: { x: 1, y: 2 } },
            { b: 2, nested: { y: 3, z: 4 } },
        );
        assert.deepEqual(result, { a: 1, b: 2, nested: { x: 1, y: 3, z: 4 } });
    });

    await t.test('arrays replace', () => {
        assert.deepEqual(deepMerge({ arr: [1, 2, 3] }, { arr: [4, 5] }), { arr: [4, 5] });
    });

    await t.test('skips null / undefined sources', () => {
        assert.deepEqual(deepMerge(null, { a: 1 }, undefined, { b: 2 }), { a: 1, b: 2 });
    });

    await t.test('later sources override earlier', () => {
        assert.deepEqual(deepMerge({ a: 1 }, { a: 2 }), { a: 2 });
    });
});

// # loadThemes
test('loadThemes', async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ume-theme-loader-'));
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

    await t.test('loads a CJS theme', async () => {
        const dir = await makeTheme(tempDir, 'cjs-theme', {});
        const themes = loadThemes([dir]);
        assert.equal(themes.length, 1);
        assert.equal(themes[0].manifest.name, 'cjs-theme');
        // Compare realpaths — macOS /var is a symlink to /private/var
        assert.equal(themes[0].rootDir, fss.realpathSync(dir));
    });

    await t.test('loads an ESM theme', async () => {
        const dir = await makeTheme(tempDir, 'esm-theme', {}, { esm: true });
        const themes = loadThemes([dir]);
        assert.equal(themes.length, 1);
        assert.equal(themes[0].manifest.name, 'esm-theme');
    });

    await t.test('throws on version mismatch', async () => {
        const dir = await makeTheme(tempDir, 'bad-version-theme', { umeVersion: '^999.0.0' });
        assert.throws(() => loadThemes([dir]), /requires umejs version/);
    });

    await t.test('deduplicates repeated themes', async () => {
        const dir = await makeTheme(tempDir, 'dedupe-theme', {});
        assert.equal(loadThemes([dir, dir]).length, 1);
    });

    await t.test('resolves extends parents', async () => {
        const parentDir = await makeTheme(tempDir, 'parent-theme', {});
        const childDir = await makeTheme(tempDir, 'child-theme', { extends: [parentDir] });
        const themes = loadThemes([childDir]);
        assert.equal(themes.length, 2);
        assert.equal(themes[0].manifest.name, 'child-theme');
        assert.equal(themes[1].manifest.name, 'parent-theme');
    });

    await t.test('child config overrides parent config', async () => {
        const parentDir = await makeTheme(tempDir, 'pri-parent', {
            config: { color: 'blue', title: 'Parent Title' },
        });
        const childDir = await makeTheme(tempDir, 'pri-child', {
            extends: [parentDir],
            config: { title: 'Child Title' },
        });
        const ctx = buildContext({ contentDir: '/tmp/x', themes: [childDir] });
        assert.equal(ctx.config.color, 'blue'); // from parent
        assert.equal(ctx.config.title, 'Child Title'); // child wins over parent
    });
});

// # buildContext
test('buildContext', async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ume-context-'));
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

    await t.test('merges config with theme lowest priority', async () => {
        const themeDir = await makeTheme(tempDir, 'theme-config', {
            config: { a: 1, b: { x: 1, y: 2 } },
        });
        const ctx = buildContext({
            contentDir: '/tmp/x',
            themes: [themeDir],
            config: { b: { y: 99 }, c: 3 },
        });

        // remove _ume because its unneeded here
        delete ctx.config._ume;

        assert.deepEqual(ctx.config, { a: 1, b: { x: 1, y: 99 }, c: 3 });
    });

    await t.test('registers helpers via setup()', async () => {
        const themeDir = await makeTheme(tempDir, 'theme-setup', {
            setup(api) {
                api.registerHelper('greeting', () => 'hello');
                api.registerInclude('custom', 'INLINE');
            },
        });
        const ctx = buildContext({ contentDir: '/tmp/x', themes: [themeDir] });
        assert.equal(ctx.helpers.greeting(), 'hello');
        assert.equal(ctx.includes.custom, 'INLINE');
    });

    await t.test('explicit templatePath wins over theme entryTemplate', async () => {
        const themeDir = await makeTheme(tempDir, 'theme-entry', {});
        const ctx = buildContext({
            contentDir: '/tmp/x',
            themes: [themeDir],
            templatePath: '/abs/my-template.html',
        });
        assert.equal(ctx.resolveTemplate(undefined), '/abs/my-template.html');
    });

    await t.test('throws when no template can be found', () => {
        assert.throws(
            () => buildContext({ contentDir: '/tmp/x' }).resolveTemplate(undefined),
            /No default template found/,
        );
    });

    await t.test('sanitizes asset paths (traversal)', async () => {
        const themeDir = await makeTheme(
            tempDir,
            'theme-assets',
            {},
            { assets: { 'style.css': 'body{}' } },
        );
        const ctx = buildContext({ contentDir: '/tmp/x', themes: [themeDir] });
        assert.equal(ctx.resolveAsset('../../../etc/passwd'), null);
        assert.ok(ctx.resolveAsset('style.css'));
    });

    await t.test('frontmatter template is resolved through templatesDir', async () => {
        const themeDir = await makeTheme(tempDir, 'theme-ftemplate', {});
        await fs.writeFile(
            path.join(themeDir, 'templates', 'post.ume.html'),
            '<post>{_BODY}</post>',
        );
        const ctx = buildContext({ contentDir: '/tmp/x', themes: [themeDir] });
        assert.ok(ctx.resolveTemplate('post.ume.html').endsWith('post.ume.html'));
    });

    await t.test('missing frontmatter template throws', async () => {
        const themeDir = await makeTheme(tempDir, 'theme-ftemplate-missing', {});
        const ctx = buildContext({ contentDir: '/tmp/x', themes: [themeDir] });
        assert.throws(() => ctx.resolveTemplate('nonexistent.ume.html'), /Template not found/);
    });

    await t.test('user templatesDir overrides theme templates', async () => {
        const themeDir = await makeTheme(tempDir, 'theme-override', {});
        const userTemplatesDir = path.join(tempDir, 'user-templates');
        await fs.mkdir(userTemplatesDir, { recursive: true });
        await fs.writeFile(path.join(userTemplatesDir, 'layout.ume.html'), '<user>{_BODY}</user>');
        const ctx = buildContext({
            contentDir: '/tmp/x',
            themes: [themeDir],
            templatesDir: userTemplatesDir,
        });
        assert.ok(ctx.resolveTemplate(undefined).includes('user-templates'));
    });
});

// # ume() object integration with themes
test('umejs theme integration', async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ume-theme-int-'));
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

    const contentDir = path.join(tempDir, 'content');
    await fs.mkdir(contentDir);

    const startApp = async (options) => {
        const app = express();
        const middleware = ume({ contentDir, quiet: true, cachePath: false, ...options });
        app.use('/{*slug}', middleware);
        const server = app.listen(0);
        await new Promise((resolve) => server.on('listening', resolve));
        const port = server.address().port;
        return {
            port,
            middleware,
            close: async () => {
                server.closeAllConnections();
                await new Promise((resolve) => server.close(resolve));
                if (typeof middleware.close === 'function') await middleware.close();
            },
        };
    };

    await t.test('theme renders markdown through layout', async () => {
        const themeDir = await makeTheme(tempDir, 'render-theme', {
            config: { siteTitle: 'Theme Title' },
            helpers: { greeting: () => 'hi from theme' },
        });
        await fs.writeFile(path.join(contentDir, 'page.md'), '# Hello world');
        const { port, close } = await startApp({ themes: [themeDir] });
        const text = await (await fetch(`http://localhost:${port}/page`)).text();
        assert.match(text, /Hello world/);
        await close();
    });

    await t.test('config overrides from user take effect', async () => {
        const themeDir = await makeTheme(
            tempDir,
            'override-theme',
            { config: { siteTitle: 'Default Title' } },
            { layoutHtml: '<title>{siteTitle}</title>{_BODY}' },
        );
        await fs.writeFile(path.join(contentDir, 'override.md'), '# content');
        const { port, close } = await startApp({
            themes: [themeDir],
            config: { siteTitle: 'Overridden Title' },
        });
        const text = await (await fetch(`http://localhost:${port}/override`)).text();
        assert.match(text, /<title>Overridden Title<\/title>/);
        await close();
    });

    await t.test('theme assets are served at /_ume/assets/*', async () => {
        const themeDir = await makeTheme(
            tempDir,
            'asset-theme',
            {},
            { assets: { 'style.css': 'body { color: red; }' } },
        );
        await fs.writeFile(path.join(contentDir, 'any.md'), '# hi');
        const { port, close } = await startApp({ themes: [themeDir] });
        const res = await fetch(`http://localhost:${port}/_ume/assets/style.css`);
        assert.equal(res.status, 200);
        assert.match(await res.text(), /color: red/);
        await close();
    });

    await t.test('missing asset returns 404', async () => {
        const themeDir = await makeTheme(
            tempDir,
            'missing-asset-theme',
            {},
            { assets: { 'style.css': 'body{}' } },
        );
        await fs.writeFile(path.join(contentDir, 'any.md'), '# hi');
        const { port, close } = await startApp({ themes: [themeDir] });
        const res = await fetch(`http://localhost:${port}/_ume/assets/nope.css`);
        assert.equal(res.status, 404);
        await close();
    });

    await t.test('user assets override theme assets', async () => {
        const themeDir = await makeTheme(
            tempDir,
            'override-assets-theme',
            {},
            { assets: { 'style.css': 'body { color: red; }' } },
        );
        const userAssetsDir = path.join(tempDir, 'user-assets');
        await fs.mkdir(userAssetsDir);
        await fs.writeFile(path.join(userAssetsDir, 'style.css'), 'body { color: blue; }');

        await fs.writeFile(path.join(contentDir, 'x.md'), '# hi');
        const { port, close } = await startApp({
            themes: [themeDir],
            assetsDir: userAssetsDir,
        });
        const text = await (await fetch(`http://localhost:${port}/_ume/assets/style.css`)).text();
        assert.match(text, /color: blue/);
        await close();
    });

    await t.test('partials from theme render inside template', async () => {
        const themeDir = await makeTheme(
            tempDir,
            'partial-theme',
            {},
            {
                layoutHtml: '<html>{_INCLUDE("header.ume.html")}{_BODY}</html>',
                partials: { 'header.ume.html': '<header>HEADER-CONTENT</header>' },
            },
        );
        await fs.writeFile(path.join(contentDir, 'p.md'), '# body');
        const { port, close } = await startApp({ themes: [themeDir] });
        const text = await (await fetch(`http://localhost:${port}/p`)).text();
        assert.match(text, /HEADER-CONTENT/);
        await close();
    });
});
