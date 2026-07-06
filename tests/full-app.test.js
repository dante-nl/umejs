const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const ume = require('../index');

test('umejs integration tests', async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ume-test-'));

    // setup shared directories
    const contentDir = path.join(tempDir, 'content');
    const templatePath = path.join(tempDir, 'layout.ume.html');
    await fs.mkdir(contentDir);
    await fs.writeFile(templatePath, '<html><body>{_BODY}</body></html>');

    t.after(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    // helper to start the server
    const startApp = async (options) => {
        const app = express();
        const middleware = ume({ contentDir, templatePath, quiet: true, ...options });
        app.use('/{*slug}', middleware);
        const server = app.listen(0);
        await new Promise((resolve) => server.on('listening', resolve));
        const port = server.address().port;
        return { port, close: () => server.close() };
    };
    // test if simple webpage works
    await t.test('simple webpage', async () => {
        await fs.writeFile(path.join(contentDir, 'simple.md'), 'Hello world!');
        const { port, close } = await startApp();
        const res = await fetch(`http://localhost:${port}/simple`);
        assert.match(await res.text(), /Hello world!/);
        await close();
    });

    // custom helper
    await t.test('supports custom helpers (cache)', async () => {
        await fs.writeFile(path.join(contentDir, 'helper.md'), 'Test: {test}');
        const { port, close } = await startApp({
            helpers: {
                test: {
                    helper: () => {
                        return 'HELLO';
                    },
                    cache: true,
                },
            },
        });
        const res = await fetch(`http://localhost:${port}/helper`);
        assert.match(await res.text(), /Test: HELLO/);
        await close();
    });

    await t.test('supports custom helpers (realtime)', async () => {
        await fs.writeFile(path.join(contentDir, 'helper.md'), 'Time: {test}');
        const { port, close } = await startApp({
            helpers: {
                test: {
                    helper: () => {
                        return Date.now();
                    },
                    cache: false,
                },
            },
        });
        const res = await fetch(`http://localhost:${port}/helper`);
        assert.match(await res.text(), /Time: (\d+)/);

        await close();
    });
    // test if custom builders work
    await t.test('supports custom builders', async () => {
        await fs.writeFile(path.join(contentDir, 'builder.md'), '[test]');
        const { port, close } = await startApp({
            builders: [
                (req, res, slug, finalHtml) => {
                    return finalHtml.replace('[test]', 'built-content');
                },
            ],
        });
        const res = await fetch(`http://localhost:${port}/builder`);
        assert.match(await res.text(), /built-content/);
        await close();
    });

    // tests if variables are escaped
    await t.test('escaped variables are restored', async () => {
        const mdFile = path.join(contentDir, 'escape.md');
        await fs.writeFile(mdFile, '\\\\{_SLUG} should appear literally.');
        const { port, close } = await startApp({});

        const res = await fetch(`http://localhost:${port}/escape`);
        assert.match(await res.text(), /{_SLUG}/);
        await close();
    });

    // test if custom parsing works
    await t.test('supports custom parsers', async () => {
        await fs.writeFile(path.join(contentDir, 'custom.md'), '[test]');
        const { port, close } = await startApp({
            parsers: [(md) => md.replace('[test]', 'parsed-content')],
        });
        const res = await fetch(`http://localhost:${port}/custom`);
        assert.match(await res.text(), /parsed-content/);
        await close();
    });

    await t.test('nextUsage on 404 calls next()', async () => {
        const app = express();
        const middleware = ume({
            contentDir,
            templatePath,
            quiet: true,
            nextUsage: true,
        });

        app.use('/{*slug}', middleware);
        // add a fallback route to catch if next is called
        app.use((req, res) => {
            res.status(404).send('Fallback');
        });

        const server = app.listen(0);
        await new Promise((resolve) => server.on('listening', resolve));
        const port = server.address().port;

        // fetch non-existant page
        const res = await fetch(`http://localhost:${port}/does-not-exist`);
        const text = await res.text();

        // check if it's actually 404 and if the text matches
        assert.strictEqual(res.status, 404);
        assert.strictEqual(text, 'Fallback');

        server.close();
    });

    await t.test('custom 404 page is served', async () => {
        const notFoundHtml = path.join(tempDir, '404.html');
        await fs.writeFile(notFoundHtml, '<h1>Custom 404</h1>');

        const { port, close } = await startApp({
            notFoundPath: notFoundHtml,
        });

        const res = await fetch(`http://localhost:${port}/missing`);
        const text = await res.text();

        assert.strictEqual(res.status, 404);
        assert.strictEqual(text, '<h1>Custom 404</h1>');

        await close();
    });

    await t.test('default 404 fallback works', async () => {
        const { port, close } = await startApp({}); // no notFoundPath

        const res = await fetch(`http://localhost:${port}/non-existent`);
        const text = await res.text();

        assert.strictEqual(res.status, 404);
        assert.match(text, /umejs/); // the default message contains "umejs"
        assert.match(text, /404 - file not found/);

        await close();
    });

    await t.test('error in helper triggers 500', async () => {
        const mdFile = path.join(contentDir, 'error.md');
        await fs.writeFile(mdFile, 'This will break: {BREAK}');

        const { port, close } = await startApp({
            helpers: {
                BREAK: () => {
                    throw new Error('Helper error');
                },
            },
        });

        const res = await fetch(`http://localhost:${port}/error`);
        const text = await res.text();

        assert.strictEqual(res.status, 500);
        assert.match(text, /Internal server error/);

        await close();
    });

    await t.test('nextUsage with error calls next(err)', async () => {
        const app = express();

        const mdFile = path.join(contentDir, 'error-next.md');
        await fs.writeFile(mdFile, 'This will break: {BREAK}');

        const middleware = ume({
            contentDir,
            templatePath,
            quiet: true,
            mode: 'development',
            nextUsage: true,
            helpers: {
                BREAK: () => {
                    throw new Error('Helper error');
                },
            },
        });

        app.use('/{*slug}', middleware);
        // Catch-all error handler
        app.use((err, req, res) => {
            res.status(500).send('Caught error: ' + err.message);
        });

        const server = app.listen(0);
        await new Promise((resolve) => server.on('listening', resolve));
        const port = server.address().port;

        const res = await fetch(`http://localhost:${port}/error-next`);
        const text = await res.text();

        assert.strictEqual(res.status, 500);
        assert.match(text, /Caught error: Helper error/);
        // next was called with the error

        await server.close();
    });

    process.exit(0);
});
