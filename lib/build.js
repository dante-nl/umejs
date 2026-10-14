// ume/lib/build.js
// * build single file

const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');
const crypto = require('node:crypto');
const { replaceAll, getAllMarkdownFiles } = require('./helpers');
const { processPartials } = require('./partials');
const { log, logError, logWarn } = require('./logger');
const { parse } = require('markdown-frontmatter-parser');

const RESERVED_KEYS = ['_BODY', '_TEST', '_SLUG'];

const MARKDOWN_TEST = `**umejs markdown test**

# h1
## h2
### h3
### h4
#### h5
##### h6

**bold**

*italic*

~~strikethrough~~

> Blockquote

[link](https://example.com)

https://example.com

* list with items
* item 1
    - sub item 1
    - sub item 2
* item 2

1. numbered list
2. second item
3. third item

\`small code block\`

\`\`\`
full width code block, no language
\`\`\`

\`\`\`js
// javascript codeblock
var x = "Hello world";
console.log(x)
\`\`\`

---
^ horizontal line


images:

250px:

![random image, 500x500](https://picsum.photos/250)

500px:

![random image, 500x500](https://picsum.photos/500)

1000px:

![random image, 1000x1000](https://picsum.photos/1000)

---
^ horizontal line

Lorem dolor ea laboris amet ipsum officia nisi sunt commodo. Amet laboris nisi reprehenderit reprehenderit minim aliqua sint ex est nulla ut consectetur aliquip minim. Ex officia ut laboris excepteur. Commodo sunt occaecat est cillum deserunt non est pariatur incididunt incididunt et tempor ex. Quis adipisicing dolor irure amet ex est. Velit aute nostrud duis enim nostrud et laboris incididunt minim eu nisi nostrud non do.

Incididunt eu in mollit pariatur. Veniam magna nulla dolor duis eu elit eu anim. Cupidatat eu in aliquip ex dolore. Exercitation velit elit sit reprehenderit labore non occaecat consectetur ea aliquip cupidatat incididunt esse duis. Sunt aliquip esse dolor nulla dolor qui aliqua reprehenderit consequat voluptate ullamco dolore mollit nostrud. Consectetur qui in ut aliquip minim qui fugiat excepteur esse ullamco. Dolor ipsum sint voluptate elit proident voluptate culpa laboris velit culpa non.
`;

/**
 * Hases the contents of a file, which allows for checking changes
 * @param {string} content Raw contents of a file
 * @returns {string} the sha256 hash of said content
 */
function getFileHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Build a single Markdown file into HTML
 * @param {string} file - The filename (e.g., "hello-world.md")
 * @param {Object} options - Build options
 * @param {string} options.contentDir - Directory containing .md files
 * @param {string} options.template - The template HTML string
 * @param {Map} options.cache - The cache to store built files in
 * @param {Map} options.astCache - The cache AST cache for markdown files
 * @param {Array<string>} options.forbiddenKeys - Keys that cannot be used in frontmatter
 * @param {string|null} [options.partialsDir] - Directory containing partials (null = disabled)
 * @param {boolean} [options.quiet]- Suppress logs
 * @param {boolean} [options.verbose] - Enable detailed logs
 * @param {object} [options.cachedHelpers] - A key-object pair of {variableName} and helper functions
 * @param {object} [options.parsers] - The helpers object that the user asked to run on cache
 * @param {(markdown: string) => Promise<{ tokens: any[], html: string }>} [options.lexer]
 *   Async function that lexes and parses Markdown. Defaults to a synchronous
 *   local implementation; can be swapped for a worker-pool dispatcher.
 */
async function buildSingleFile(file, options) {
    const {
        contentDir,
        template,
        partialsDir,
        forbiddenKeys,
        cache,
        astCache,
        quiet,
        verbose,
        cachedHelpers,
        parsers,
        lexer,
    } = options;

    /* c8 ignore next */
    if (verbose) log(`Building ${file}...`, null, false);

    const fullPath = path.join(contentDir, file);
    const raw = fs.readFileSync(fullPath, 'utf-8');
    // derive slug from relative path without extension
    const slug = file.replace(/\.md$/, '');

    // bridge from gray-matter to markdown-frontmatter-parser bcs im lazy and dont want to rename variables
    const [headers, body] = parse(raw);
    const data = headers;
    const content = body;

    const cachedEntry = astCache.get(slug);
    const currentHash = getFileHash(raw);

    let tokens;
    let htmlContent;

    if (cachedEntry && cachedEntry.hash === currentHash) {
        // cache hit, reuse the AST, skip lexing entirely
        if (verbose) log(`AST cache hit for ${file}`, null, false);
        tokens = cachedEntry.tokens;
        htmlContent = marked.parser(tokens);
    } else {
        // cache miss, pre-process markdown on main thread; then dispatch expensive lex+parse to lexer
        if (verbose) log(`AST cache miss for ${file}, lexing...`, null, false);

        let contentWithPartials = processPartials(content, partialsDir, quiet);
        contentWithPartials = replaceAll(contentWithPartials, '{_TEST}', MARKDOWN_TEST);

        if (parsers) {
            parsers.forEach((parser) => {
                const returnMarkdown = parser(contentWithPartials);
                if (typeof returnMarkdown === 'string') {
                    contentWithPartials = returnMarkdown;
                }
            });
        }

        const result = await lexer(contentWithPartials);
        tokens = result.tokens;
        htmlContent = result.html;

        astCache.set(slug, { hash: currentHash, tokens });
    }

    // // insert everything into markdown, properly parse it again if needed
    // // const htmlContent = await marked.parse(contentWithPartials);
    // const htmlContent = marked.parser(tokens);

    // insert the actual body into the template
    let finalHtml = replaceAll(template, '{_BODY}', htmlContent);
    // let finalHtml = replaceAll(template, '{_BODY}', contentWithPartials);

    // and finally handle any partials that may be included in
    finalHtml = processPartials(finalHtml, partialsDir, quiet);

    // add formatter values
    for (const [key, value] of Object.entries(data)) {
        /* c8 ignore next */
        if (verbose) log(`Initialising variable ${key}`, null, false);

        if (forbiddenKeys.includes(key)) {
            logError(
                `Forbidden key error: "${key}" is reserved or used as a helper in ${file}`,
                quiet,
            );
            throw new Error(`Forbidden key: ${key}`);
        }
        finalHtml = replaceAll(finalHtml, `{${key}}`, String(value));
    }

    // add any final cached helpers
    if (cachedHelpers) {
        for (let [key, fn] of Object.entries(cachedHelpers)) {
            if (typeof fn === 'function') {
                const dynamicValue = fn(slug);

                if (dynamicValue instanceof Promise) {
                    logWarn(
                        `Helper '${key}' returned a Promise. Async helpers are not supported in synchronous builds. Skipping.`,
                    );
                    continue;
                }

                finalHtml = replaceAll(finalHtml, `{${key}}`, dynamicValue);
            } else {
                logWarn(`Invalid helper provided (expected type function, helper is ${typeof fn})`);
                console.log(fn);
            }
        }
    }

    cache.set(slug, finalHtml);
    /* c8 ignore next */
    if (verbose) log(`Built ${file}`, null, false);
}

/**
 * Build all Markdown files in a directory
 * @param {Object} options - Build options
 * @param {string} options.contentDir - Directory containing .md files
 * @param {string} options.template - The template HTML string
 * @param {string|null} options.partialsDir - Directory containing partials (null = disabled)
 * @param {Array<string>} options.forbiddenKeys - Keys that cannot be used in frontmatter
 * @param {Map} options.cache - The cache to store built files in
 * @param {Map} options.astCache - The AST cache to tore previously built files
 * @param {boolean} options.quiet - Suppress logs
 * @param {boolean} options.verbose - Enable detailed logs
 * @param {Array<Function>} [options.parsers] - An array of custom functions that get passed the raw Markdown on build and should return valid Markdown
 * @param {(markdown: string) => Promise<{ tokens: any[], html: string }>} [options.lexer] - Lexer to forward
 * @returns {Promise<string[]>} - Number of files built
 */
async function buildAllFiles(options) {
    const { contentDir, quiet, verbose } = options;

    let mdFiles;
    try {
        mdFiles = getAllMarkdownFiles(contentDir);
    } catch (err) {
        logError(`Content directory not found at ${contentDir}`, quiet);
        throw err;
    }

    /* c8 ignore next */
    if (verbose) log(`Found ${mdFiles.length} Markdown file(s) in ${contentDir}`, null, false);

    // for (const file of mdFiles) {
    //     try {
    //         buildSingleFile(file, options);
    //     } catch (err) {
    //         logError(`Skipping ${file}; ${err.message}`, quiet);
    //         continue;
    //     }
    // }
    await Promise.all(
        mdFiles.map((file) =>
            buildSingleFile(file, options).catch((err) => {
                logError(`Skipping ${file}; ${err.message}`, quiet);
            }),
        ),
    );

    if (!quiet) {
        log(
            `${mdFiles.length} Markdown file(s) in ${contentDir} have been generated.`,
            'green',
            false,
        );
    }

    return mdFiles;
}

module.exports = {
    buildSingleFile,
    buildAllFiles,
    RESERVED_KEYS,
};
