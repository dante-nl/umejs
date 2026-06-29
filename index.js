// ume
// untitled markdown engine

/**
 * Configuration options for the ume middleware.
 * 
 * @typedef {Object} UmeOptions
 * @property {string} contentDir - **Required**. Path to the directory containing .md files.
 * @property {string} templatePath - **Required**. Path to the .html template file.
 * @property {boolean} [quiet=false] - Suppress all console output except errors.
 * @property {boolean} [verbose=false] - Enable detailed build logs (overrides quiet).
 * @property {Object.<string, Function>} [helpers] - Dynamic functions executed per request.
 *   Each function receives `(req, res, slug)` and must return a string.
 * @property {'development' | 'production'} [mode='production'] - 'development' enables file watching.
 * @property {string} [partialsDir] - Path to partials directory. If omitted, partials are disabled.
 */

const fs = require('fs');
const path = require('path');
const marked = require('marked');
const matter = require('gray-matter');
const { styleText } = require("util");
const { replaceAll } = require("./helper/regex");

const RESERVED_KEYS = ["_BODY"];

/**
 * Express middleware that turns Markdown files into HTML pages.
 * 
 * @param {UmeOptions} options
 * @returns {import('express').RequestHandler}
 */
module.exports = function ume(options) {
    let {
        contentDir,
        templatePath,
        quiet,
        verbose,
        helpers,
        mode,
        partialsDir
    } = options;

    helpers = helpers || {};

    mode = mode || "production";

    const FORBIDDEN_KEYS = [...RESERVED_KEYS, ...Object.keys(helpers)];

    // if user for some reason wants quiet and loud logs, handle that
    if (quiet && verbose) {
        quiet = false;
        console.log(styleText("yellow", "[umejs] Both quiet and verbose output specified; ignoring quiet setting"));
    }

    // load template
    if (!quiet) console.log(styleText("yellow", "[umejs] Initialising project at " + contentDir));

    let template;
    try {
        template = fs.readFileSync(templatePath, 'utf-8');
    } catch (err) {
        console.error(styleText("red", `[umejs] FATAL: Template file not found at ${templatePath}`));
        process.exit(1);
    }

    // define cache
    const cache = new Map();

    // * handle partials
    function processPartials(htmlString) {
        // if no partials, return same content
        if (!partialsDir) return htmlString;

        const regex = /\{_INCLUDE\(["']([^"']+)["']\)\}/g;

        return htmlString.replace(regex, (match, filename) => {
            // prevent directory traversal
            const safeFilename = path.basename(filename);
            const partialPath = path.join(partialsDir, safeFilename);

            try {
                const content = fs.readFileSync(partialPath, 'utf-8');
                return processPartials(content);
            } catch (err) {
                console.warn(styleText("yellow", `[umejs] Partial not found: ${filename}`));
                return match;
            }
        });
    }

    // * build single file
    function buildSingleFile(file) {
        if (verbose) console.log("[umejs] Building " + file + "...");

        const slug = path.basename(file, '.md');
        const raw = fs.readFileSync(path.join(contentDir, file), 'utf-8');

        const { data, content } = matter(raw);
        const htmlContent = marked.parse(content);

        // inject body
        let finalHtml = replaceAll(template, "{_BODY}", htmlContent);

        // add partials
        // done after body because the body may include some partials of its own
        finalHtml = processPartials(finalHtml);

        // add custom frontmatter variables
        for (const [key, value] of Object.entries(data)) {
            if (verbose) console.log("[umejs] Initialising variable " + key);

            if (FORBIDDEN_KEYS.includes(key)) {
                console.error(styleText("red", `[umejs] Forbidden key error: "${key}" is reserved or used as a helper in ${file}`));
                throw new Error(`Forbidden key: ${key}`);
            }
            finalHtml = replaceAll(finalHtml, `{${key}}`, value);
        }

        cache.set(slug, finalHtml);
        if (!quiet) console.log(`[umejs] Built ${file}`);
    }

    // * build files
    let mdFiles;
    try {
        mdFiles = fs.readdirSync(contentDir).filter(f => f.endsWith('.md'));
    } catch (err) {
        console.error(styleText("red", `[umejs] FATAL: Content directory not found at ${contentDir}`));
        process.exit(1);
    }

    if (verbose) console.log(`[umejs] Found ${mdFiles.length} Markdown file(s) in ${contentDir}`);

    for (const file of mdFiles) {
        try {
            buildSingleFile(file);
        } catch (err) {
            console.error(styleText("red", `[umejs] ERROR: Skipping ${file}; ${err.message}`));
            continue;
        }
    }

    if (!quiet) {
        console.log(styleText("green", `[umejs] ${mdFiles.length} Markdown file(s) in ${contentDir} have been generated.`));
    }

    // ---- DEV MODE ----
    if (mode === 'development') {
        let timeout = null;

        fs.watch(contentDir, { recursive: true }, (event, filename) => {
            if (!filename) return;

            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                // to prevent quick updates in succession
                // handle an update to a partial file
                if (partialsDir && filename.startsWith('partials/')) {
                    if (!quiet) console.log(`[umejs] Partial changed (${filename}), rebuilding all pages...`);
                    for (const file of mdFiles) {
                        try {
                            buildSingleFile(file);
                        } catch (err) {
                            console.error(styleText("red", `[umejs] ERROR: Skipping ${file}; ${err.message}`));
                        }
                    }
                }
                // handle update for a simple regular markdown
                else if (filename.endsWith('.md')) {
                    if (!quiet) console.log(`[umejs] Detected change in ${filename}, rebuilding...`);
                    try {
                        buildSingleFile(filename);
                    } catch (err) {
                        console.error(styleText("red", `[umejs] ERROR: Failed to rebuild ${filename}; ${err.message}`));
                    }
                }

                timeout = null;
            }, 150);
        });

        if (!quiet) {
            console.log(styleText("yellow", "[umejs] Dev mode active. Watching for changes..."));
        }
    }

    // * express middleware
    return function (req, res, next) {
        try {
            let slug = req.params.slug || req.params[0] || '';

            if (Array.isArray(slug)) {
                slug = slug.join('/');
            }

            const slugName = path.basename(slug);
            const html = cache.get(slugName);

            if (!slug || !html) {
                return res.status(404).send('File not found');
            }

            let finalHtml = html;
            for (const [key, fn] of Object.entries(helpers)) {
                if (typeof fn === 'function') {
                    const dynamicValue = fn(req, res, slugName);
                    finalHtml = replaceAll(finalHtml, `{${key}}`, dynamicValue);
                }
            }

            res.set('Content-Type', 'text/html');
            res.send(finalHtml);
        } catch (err) {
            console.error('[umejs] Request error:', err.message);
            res.status(500).send('Internal server error');
        }
    };
};