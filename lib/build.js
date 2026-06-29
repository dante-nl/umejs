// ume/lib/build.js
// * build single file

const fs = require('fs');
const path = require('path');
const marked = require('marked');
const matter = require('gray-matter');
const { replaceAll } = require('../lib/helpers');
const { processPartials } = require('./partials');
const { log, logError } = require('./logger');

const RESERVED_KEYS = ["_BODY"];

/**
 * Build a single Markdown file into HTML
 * @param {string} file - The filename (e.g., "hello-world.md")
 * @param {Object} options - Build options
 * @param {string} options.contentDir - Directory containing .md files
 * @param {string} options.template - The template HTML string
 * @param {string|null} options.partialsDir - Directory containing partials (null = disabled)
 * @param {Array<string>} options.forbiddenKeys - Keys that cannot be used in frontmatter
 * @param {Map} options.cache - The cache to store built files in
 * @param {boolean} options.quiet - Suppress logs
 * @param {boolean} options.verbose - Enable detailed logs
 * @returns {void}
 */
function buildSingleFile(file, options) {
    const {
        contentDir,
        template,
        partialsDir,
        forbiddenKeys,
        cache,
        quiet,
        verbose
    } = options;

    if (verbose) log(`Building ${file}...`, null, false);

    const slug = path.basename(file, '.md');
    const raw = fs.readFileSync(path.join(contentDir, file), 'utf-8');

    const { data, content } = matter(raw);
    const htmlContent = marked.parse(content);

    // inject body
    let finalHtml = replaceAll(template, "{_BODY}", htmlContent);

    // add partials
    // done after body because the body may include some partials of its own
    finalHtml = processPartials(finalHtml, partialsDir, quiet);

    // add custom frontmatter variables
    for (const [key, value] of Object.entries(data)) {
        if (verbose) log(`Initialising variable ${key}`, null, false);

        if (forbiddenKeys.includes(key)) {
            logError(`Forbidden key error: "${key}" is reserved or used as a helper in ${file}`, quiet);
            throw new Error(`Forbidden key: ${key}`);
        }
        finalHtml = replaceAll(finalHtml, `{${key}}`, value);
    }

    cache.set(slug, finalHtml);
    if (!quiet) log(`Built ${file}`, null, false);
}

/**
 * Build all Markdown files in a directory
 * @param {Object} options - Build options
 * @param {string} options.contentDir - Directory containing .md files
 * @param {string} options.template - The template HTML string
 * @param {string|null} options.partialsDir - Directory containing partials (null = disabled)
 * @param {Array<string>} options.forbiddenKeys - Keys that cannot be used in frontmatter
 * @param {Map} options.cache - The cache to store built files in
 * @param {boolean} options.quiet - Suppress logs
 * @param {boolean} options.verbose - Enable detailed logs
 * @returns {number} - Number of files built
 */
function buildAllFiles(options) {
    const { contentDir, quiet, verbose } = options;

    let mdFiles;
    try {
        mdFiles = fs.readdirSync(contentDir).filter(f => f.endsWith('.md'));
    } catch (err) {
        logError(`Content directory not found at ${contentDir}`, quiet);
        throw err;
    }

    if (verbose) log(`Found ${mdFiles.length} Markdown file(s) in ${contentDir}`, null, false);

    for (const file of mdFiles) {
        try {
            buildSingleFile(file, options);
        } catch (err) {
            logError(`Skipping ${file}; ${err.message}`, quiet);
            continue;
        }
    }

    if (!quiet) {
        log(`${mdFiles.length} Markdown file(s) in ${contentDir} have been generated.`, "green", false);
    }

    return mdFiles.length;
}

module.exports = {
    buildSingleFile,
    buildAllFiles,
    RESERVED_KEYS
};