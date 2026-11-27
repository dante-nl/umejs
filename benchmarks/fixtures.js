// benchmarks/fixtures.js
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function writeFile(dir, name, frontmatter, body) {
    const fm = frontmatter ? `---\n${frontmatter}\n---\n` : '';
    fs.writeFileSync(path.join(dir, name), `${fm}${body}`);
}

function generateVeryLargePage(dir) {
    // ~30k words, ~500 headings, mixed content
    const blocks = [];
    for (let i = 0; i < 500; i++) {
        blocks.push(`## Section ${i}`);
        blocks.push('Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(30));
        blocks.push('- Item one\n- Item two\n- Item three');
        blocks.push('```js\nconst x = ' + i + ';\nconsole.log(x);\n```');
        blocks.push('A [link](https://example.com/' + i + ') and *emphasis* and **strong**.');
    }
    writeFile(dir, 'huge-0.md', 'title: Huge Page', '# Huge Page\n\n' + blocks.join('\n\n'));
}

/**
 * Creates a temp content directory with a representative mix of pages.
 * @param {object} [opts]
 * @param {number} [opts.simple=40] Plain markdown pages
 * @param {number} [opts.withIncludes=20] Pages that include partials
 * @param {number} [opts.withVariables=20] Pages with frontmatter vars + realtime helpers
 * @param {number} [opts.large=20] Large body pages
 * @param {boolean} [opts.nested=false] Also create nested index pages
 * @returns {{ dir: string, cleanup: () => void, counts: object }}
 */
function generateFixtures(opts = {}) {
    const {
        simple = 40,
        withIncludes = 20,
        withVariables = 20,
        large = 20,
        huge = 1,
        nested = true,
    } = opts;

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ume-bench-'));
    const contentDir = path.join(root, 'content');
    const partialsDir = path.join(root, 'partials');
    const templatePath = path.join(root, 'layout.ume.html');
    fs.mkdirSync(contentDir);
    fs.mkdirSync(partialsDir);

    // minimal layout with the standard slots
    fs.writeFileSync(
        templatePath,
        '<!doctype html><html><head><title>{title}</title></head>' +
            '<body>{_INCLUDE("header.ume.html")}<main>{_BODY}</main>' +
            '{_INCLUDE("footer.ume.html")}</body></html>',
    );
    fs.writeFileSync(path.join(partialsDir, 'header.ume.html'), '<header>Site Header</header>');
    fs.writeFileSync(path.join(partialsDir, 'footer.ume.html'), '<footer>Site Footer</footer>');

    const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(10);

    for (let i = 0; i < simple; i++) {
        writeFile(contentDir, `simple-${i}.md`, `title: Simple ${i}`, `# Simple ${i}\n\n${lorem}`);
    }
    for (let i = 0; i < withIncludes; i++) {
        writeFile(
            contentDir,
            `include-${i}.md`,
            `title: With Include ${i}`,
            `# Include ${i}\n\n{_INCLUDE("header.ume.html")}\n\n${lorem}\n\n{_INCLUDE("footer.ume.html")}`,
        );
    }
    for (let i = 0; i < withVariables; i++) {
        writeFile(
            contentDir,
            `vars-${i}.md`,
            `title: Vars ${i}\nauthor: Alice\ncount: ${i}`,
            `# Vars ${i}\n\nBy {author}, number {count}, at {_SLUG}.`,
        );
    }
    for (let i = 0; i < large; i++) {
        const body = Array.from(
            { length: 200 },
            (_, j) =>
                `## Section ${j}\n\n${'Paragraph text with *emphasis* and **strong**. '.repeat(20)}`,
        ).join('\n\n');
        writeFile(contentDir, `large-${i}.md`, `title: Large ${i}`, `# Large ${i}\n\n${body}`);
    }
    if (nested) {
        const subDir = path.join(contentDir, 'docs');
        fs.mkdirSync(subDir);
        fs.writeFileSync(path.join(subDir, 'index.md'), '---\ntitle: Docs\n---\n# Docs index');
        fs.writeFileSync(path.join(subDir, 'page.md'), '---\ntitle: Docs page\n---\n# Docs page');
    }

    if (huge > 0) generateVeryLargePage(contentDir);

    return {
        dir: root,
        contentDir,
        partialsDir,
        templatePath,
        counts: { simple, withIncludes, withVariables, large, huge, nested },
        cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
}

module.exports = { generateFixtures };
