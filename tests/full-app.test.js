// test/integration/full-app.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const ume = require('../index');

test('full Express app serves a markdown page', async (t) => {
    // create a temporary directory with a sample .md file
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ume-test-'));
    t.after(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    const contentDir = path.join(tempDir, 'content');
    await fs.mkdir(contentDir);
    await fs.writeFile(
        path.join(contentDir, 'hello.md'),
        '---\ntitle: Hello\n---\n# World\n{title}'
    );

    const templatePath = path.join(tempDir, 'layout.ume.html');
    await fs.writeFile(templatePath, '<html><body>{_BODY}</body></html>');

    // create Express app with middleware
    const app = express();
    app.use('/{*slug}', ume({ contentDir, templatePath }));

    // test the route
    const server = app.listen(0);
    await new Promise((resolve) => server.on('listening', resolve));
    const port = server.address().port;

    // clean up the server after the test finishes
    t.after(() => {
        server.close();
    });

    // send a real HTTP request using built-in fetch
    const response = await fetch(`http://localhost:${port}/hello`);
    const body = await response.text();

    
    // assert the response
    assert.match(body, /<h1>World<\/h1>/);
    assert.match(body, /<p>Hello<\/p>/)
    assert.match(body, /<html>.*<body>.*<\/body>.*<\/html>/s); // 's' flag allows . to match newlines
});