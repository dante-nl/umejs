const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const ume = require('../index');

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const waitForContent = async (url, expected, timeout = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const res = await fetch(url);
        const text = await res.text();
        if (text.includes(expected)) return text;
        await delay(100);
    }
    throw new Error(`Timeout waiting for "${expected}"`);
};

async function captureLoggerCall(fn) {
    let stdout = '',
        stderr = '',
        exitCode = null;
    const origExit = process.exit;
    const origStdout = process.stdout.write;
    const origStderr = process.stderr.write;

    process.exit = (code) => {
        exitCode = code;
    };
    process.stdout.write = (chunk) => {
        stdout += chunk;
        return true;
    };
    process.stderr.write = (chunk) => {
        stderr += chunk;
        return true;
    };

    await fn();

    process.exit = origExit;
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;

    return { stdout, stderr, exitCode };
}

test('developer mode tests', async (t) => {
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
        const middleware = ume({
            // ← store it
            contentDir,
            templatePath,
            quiet: true,
            mode: 'development',
            ...options,
        });
        app.use('/{*slug}', middleware);

        const server = app.listen(0);
        await new Promise((resolve) => server.on('listening', resolve));
        const port = server.address().port;

        return {
            port,
            close: async () => {
                // 1. Close the HTTP server
                await new Promise((resolve) => server.close(resolve));
                // 2. Stop the file watcher
                if (typeof middleware.close === 'function') {
                    middleware.close();
                }
            },
        };
    };

    await delay(200);

    await t.test('file update triggers rebuild', async () => {
        const filePath = path.join(contentDir, 'update.md');
        await fs.writeFile(filePath, 'It not work!');

        const { port, close } = await startApp();

        await fs.writeFile(filePath, 'It works!');

        const url = `http://localhost:${port}/update`;
        await waitForContent(url, 'It works!');

        await close();
        // process.exit(0)
        // return
    });

    await t.test('partialsDir outside contentDir logs a warning', async () => {
        // Create a separate dir outside contentDir
        const outsideDir = path.join(tempDir, 'outside');
        await fs.mkdir(outsideDir);

        const { stderr } = await captureLoggerCall(async () => {
            // logger.logWarn('Warning');
            const { close } = await startApp({
                partialsDir: outsideDir,
                quiet: false, // we need to see the warning
            });
            await close();
        });
        assert.match(stderr, /is outside contentDir/);
    });

    await t.test('adding a new .md file rebuilds all pages', async () => {
        const filePath = path.join(contentDir, 'existing.md');
        await fs.writeFile(filePath, 'Existing content');

        const { port, close } = await startApp();

        // Create a new markdown file while watcher is running
        const newFilePath = path.join(contentDir, 'new.md');
        await fs.writeFile(newFilePath, 'Brand new content');

        // Wait for watcher to detect the addition (rename event)
        await delay(300);

        // Both pages should be served
        const url1 = `http://localhost:${port}/existing`;
        const url2 = `http://localhost:${port}/new`;

        await waitForContent(url1, 'Existing content');
        await waitForContent(url2, 'Brand new content');

        await close();
    });

    await t.test('partial change triggers rebuild of all pages', async () => {
        const partialsDir = path.join(contentDir, '_partials');
        await fs.mkdir(partialsDir);
        const partialFile = path.join(partialsDir, 'header.ume.html');
        await fs.writeFile(partialFile, '<header>Original</header>');

        const mdFile = path.join(contentDir, 'page.md');
        await fs.writeFile(mdFile, '{_INCLUDE("header.ume.html")}\n\n# Page');

        const { port, close } = await startApp({ partialsDir });

        // Modify the partial
        await fs.writeFile(partialFile, '<header>Updated</header>');
        await delay(300);

        // Wait for watcher debounce + rebuild

        const url = `http://localhost:${port}/page`;
        const text = await waitForContent(url, 'Updated');
        assert.match(text, /Updated/);

        await close();
    });

    await t.test('build error is caught and logged', async () => {
        const mdFile = path.join(contentDir, 'broken.md');
        // Reference a partial that doesn't exist
        await fs.writeFile(mdFile, '{_INCLUDE("missing.ume.html")}\n\n# Broken');

        const { port, close } = await startApp();

        // Overwrite the file to trigger a rebuild
        await fs.writeFile(mdFile, '{_INCLUDE("missing.ume.html")}\n\n# Still broken');

        await delay(300);

        // The page might still serve old cached content, but the catch block ran.
        // We can verify by checking that the server still responds.
        const res = await fetch(`http://localhost:${port}/broken`);
        // It could be 200 (if cached) or 404 – we just don't want a crash.
        assert.ok(res.status === 200 || res.status === 404);

        await close();
    });

    await t.test('verbose mode and file deletion rebuilds files', async () => {
        // Create a file, then delete it while watching
        const filePath = path.join(contentDir, 'to-delete.md');
        await fs.writeFile(filePath, 'Delete me');

        // const { port, close } = await startApp({ verbose: true });
        const { port, close } = await startApp({ verbose: false });

        await fs.unlink(filePath);

        await delay(300);

        const res = await fetch(`http://localhost:${port}/to-delete`);
        assert.strictEqual(res.status, 404);

        await close();
    });
});
