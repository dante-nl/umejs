// ume/lib/build.js
// * build single file

const fs = require('fs');
const path = require('path');
const marked = require('marked');
const matter = require('gray-matter');
const { replaceAll } = require('./helpers');
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

    const fullPath = path.join(contentDir, file);
    const raw = fs.readFileSync(fullPath, 'utf-8');

    // derive slug from relative path without extension
    const slug = file.replace(/\.md$/, '');


    const { data, content } = matter(raw);
    // get partials from markdown file
    const contentWithPartials = processPartials(content, partialsDir, quiet);

    // insert everything into markdown, properly parse it again if needed
    const htmlContent = marked.parse(contentWithPartials);

    // insert the actual body into the template
    let finalHtml = replaceAll(template, "{_BODY}", htmlContent);

    // and finally handle any partials that may be included in
    finalHtml = processPartials(finalHtml, partialsDir, quiet);

    // add formatter values
    for (const [key, value] of Object.entries(data)) {
        if (verbose) log(`Initialising variable ${key}`, null, false);

        if (forbiddenKeys.includes(key)) {
            logError(`Forbidden key error: "${key}" is reserved or used as a helper in ${file}`, quiet);
            throw new Error(`Forbidden key: ${key}`);
        }
        finalHtml = replaceAll(finalHtml, `{${key}}`, value);
    }

    cache.set(slug, finalHtml);
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
 * @param {boolean} options.quiet - Suppress logs
 * @param {boolean} options.verbose - Enable detailed logs
 * @returns {number} - Number of files built
 */
function buildAllFiles(options) {
    const { contentDir, quiet, verbose } = options;

    let mdFiles;
    try {
        mdFiles = getAllMarkdownFiles(contentDir);
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

    return mdFiles;
}

// fetch all nested folders as well
function getAllMarkdownFiles(dir, baseDir = dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(getAllMarkdownFiles(fullPath, baseDir));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            // store relative path from baseDir (contentDir)
            const relativePath = path.relative(baseDir, fullPath);
            results.push(relativePath);
        }
    }
    return results;
}


module.exports = {
    buildSingleFile,
    buildAllFiles,
    RESERVED_KEYS
};