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
 * @property {Object<string, Helper>} [helpers] - Optional extra functions that run on build or for every request
 * @property {'development' | 'production'} [mode='production'] - 'development' enables file watching.
 * @property {string} [partialsDir] - Path to partials directory. If omitted, partials are disabled.
 * @property {string} [notFoundDir] - Path to an HTML page to be served for a 404 error.
 * @property {Array<Function>} [builders] - An array of custom functions that get passed the near final HTML. (before prettify)
 * @property {boolean} [pretty] - If set to `true`, ume will automatically parse the html through js-beautify
 */

/**
 * Simple helper to just return 
 * @callback SimpleHelper
 * @returns {string} The output to change the variable with
 */

/**
 * Full helper function that is executed per request.
 * @callback FullHelper
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} slug The pathname (excluding .md) that is currently visited
 * @returns {*} The output to change the variable with
 */

/**
 * When `cache` is set to true, function will be executed on startup and therefore there is no `req` or `res` to pass
 * @callback SlugHelper
 * @param {string} slug he pathname (excluding .md) of the page that is currently being built.
 * @returns {*} The output to change the variable with.
 */

/**
 * @typedef {SimpleHelper | FullHelper | SlugHelper} HelperCallable
 */

/**
 * @typedef {Object} HelperObject
 * @property {boolean} [cache=false] When set to true, the function will only be called once on build, instead of per request.
 * @property {HelperCallable} helper The helper function to execute
 */

/**
 * @typedef {HelperCallable | HelperObject} Helper
 */

const fs = require('fs');
const path = require('path');
const jsBeautify = require('js-beautify');
const { replaceAll } = require('./lib/helpers');
const { log, logError, logFatal, logWarn } = require('./lib/logger');
const { buildAllFiles, buildSingleFile, RESERVED_KEYS } = require('./lib/build');
const { setupWatcher } = require('./lib/watcher');

/**
 * umejs! expressjs middleware for serving Markdown pages
 * 
 * @param {UmeOptions} options
 * @returns
 */
module.exports = function ume(options) {
    let {
        contentDir,
        templatePath,
        quiet,
        verbose,
        helpers,
        mode,
        partialsDir,
        notFoundDir,
        pretty,
        builders
    } = options;

    helpers = helpers || {};
    mode = mode || "production";

    const FORBIDDEN_KEYS = [...RESERVED_KEYS, ...Object.keys(helpers)];

    // if user for some reason wants quiet and loud logs, handle that
    if (quiet && verbose) {
        quiet = false;
        log("Both quiet and verbose output specified; ignoring quiet setting", "yellow", false);
    }

    // load template
    if (!quiet) log(`Initialising project at ${contentDir}`, "yellow", false);
    const startTime = new Date()

    let template;
    try {
        template = fs.readFileSync(templatePath, 'utf-8');
    } catch (err) {
        logFatal(`Template file not found at ${templatePath}`);
    }

    // define cache
    const cache = new Map();

    // * build files
    const buildOptions = {
        contentDir,
        template,
        partialsDir,
        forbiddenKeys: FORBIDDEN_KEYS,
        cache,
        quiet,
        verbose,
        helpers
    };

    let mdFiles = [];
    try {
        mdFiles = buildAllFiles(buildOptions);
    } catch (err) {
        logFatal(`Failed to build files: ${err.message}`);
    }

    const deltaTime = new Date() - startTime
    log(`All files built - took ${deltaTime}ms`, "green", quiet)

    // * dev mode
    if (mode === 'development') {
        setupWatcher({
            contentDir,
            partialsDir,
            cache,
            buildSingleFile: (file) => buildSingleFile(file, buildOptions),
            buildAllFiles: () => buildAllFiles(buildOptions),
            mdFiles,
            quiet,
            verbose
        });
    }

    // * express middleware
    return function (req, res, next) {
        try {
            let slug = req.params.slug || req.params[0] || '';

            if (Array.isArray(slug)) {
                slug = slug.join('/');
            }

            // remove leading/trailing slashes if any
            slug = slug.replace(/^\/|\/$/g, '');

            const html = cache.get(slug);

            // check if page exists
            if (!slug || !html) {
                // if there is a directory for the 404 page, give that
                if (notFoundDir) {
                    res.status(404).sendFile(notFoundDir)
                } else {
                    res.status(404).send(`
                        <h2>umejs</h2>
                        <h1>404 - file not found</h1>
                        <p>The file you were looking for could not be found. <b>PRO TIP:</b> You can specify your own 404 page with umejs!</p>    
                    `);
                }
                return

            }

            let finalHtml = html;
            for (let [key, fn] of Object.entries(helpers)) {
                if (typeof fn === "object" && !fn.cache && fn.helper) {
                    // if it's a cached function, we don't need to run here (only realtime functions)
                    fn = fn.helper
                } else if (typeof fn === "object" && fn.cache) {
                    // if it is a cached object, we don't need to include it here to prevent unneeded warnings
                    continue
                }
                if (typeof fn === 'function') {
                    const dynamicValue = fn(req, res, slug);
                    finalHtml = replaceAll(finalHtml, `{${key}}`, dynamicValue);
                } else {
                    logWarn(`Invalid helper provided (expected type function, helper is ${typeof fn})`)
                    console.log(fn)
                }
            }
            
            builders.forEach(builder => { 
                if (typeof builder === 'function') {
                    const builderOutput = builder(req, res, slug, finalHtml);
                    if (typeof builderOutput === "string") {
                        finalHtml = builderOutput
                    }
                } else {
                    logWarn(`Invalid builder provided (expected type function, builder is ${typeof builder})`)
                }
            });


            // beautify the final code
            if (options.pretty) {
                finalHtml = jsBeautify.html(finalHtml, {
                    indent_size: 2,
                    indent_char: ' ',
                    max_preserve_newlines: 1,
                    preserve_newlines: true,
                    wrap_line_length: 0
                });
            }

            res.set('Content-Type', 'text/html');
            res.send(finalHtml);
        } catch (err) {
            logError(`Request error: ${err.message}`, quiet);
            res.status(500).send('[umejs] Internal server error. Try again later');
            return
        }
    };
};