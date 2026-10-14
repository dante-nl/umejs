const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const ume = require('../index');

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

test('async middleware behaviour', async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ume-async-test-'));
    const contentDir = path.join(tempDir, 'content');
    const templatePath = path.join(tempDir, 'layout.ume.html');
    await fs.mkdir(contentDir);
    await fs.writeFile(templatePath, '<html><body>{_BODY}</body></html>');

    t.after(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    await t.test('ready resolves to the list of built files', async () => {
        await fs.writeFile(path.join(contentDir, 'a.md'), 'A');
        await fs.writeFile(path.join(contentDir, 'b.md'), 'B');

        const middleware = ume({
            contentDir,
            templatePath,
            quiet: true,
            parallel: true,
        });

        const files = await middleware.ready;
        assert.ok(Array.isArray(files));
        assert.ok(files.includes('a.md'));
        assert.ok(files.includes('b.md'));

        await middleware.close();
    });

    await t.test('fatal build failure rejects ready', async () => {
        const middleware = ume({
            contentDir: path.join(tempDir, 'does-not-exist'),
            templatePath,
            quiet: true,
            parallel: true,
        });

        await assert.rejects(middleware.ready);
        await middleware.close();
    });

    await t.test('close is idempotent', async () => {
        const middleware = ume({
            contentDir,
            templatePath,
            quiet: true,
            parallel: true,
        });

        await middleware.ready;
        await middleware.close();
        await middleware.close(); // must not throw
    });

    await t.test('ume() returns without waiting for the build', async () => {
        const start = Date.now();
        const middleware = ume({
            contentDir,
            templatePath,
            quiet: true,
            parallel: true,
            parsers: [
                async (md) => {
                    await delay(500);
                    return md;
                },
            ],
        });
        const elapsed = Date.now() - start;

        // if ume() blocked on the build, elapsed would be >= 500ms
        assert.ok(elapsed < 200, `ume() blocked for ${elapsed}ms; should be synchronous`);

        await middleware.ready;
        await middleware.close();
    });

    await t.test('server responds before the build finishes', async () => {
        await fs.writeFile(path.join(contentDir, 'slow.md'), '# Slow');

        const express = require('express');
        const app = express();
        const middleware = ume({
            contentDir,
            templatePath,
            quiet: true,
            parallel: true,
            parsers: [
                async (md) => {
                    await delay(500);
                    return md;
                },
            ],
        });
        app.use('/{*slug}', middleware);

        const server = app.listen(0);
        await new Promise((r) => server.on('listening', r));
        const port = server.address().port;

        // The build is still running. The server should already be listening.
        assert.strictEqual(server.listening, true);

        // Requests block until ready resolves, then serve
        const res = await fetch(`http://localhost:${port}/slow`);
        assert.strictEqual(res.status, 200);

        await new Promise((r) => server.close(r));
        await middleware.close();
    });
});
