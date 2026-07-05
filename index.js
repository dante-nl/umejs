// ume
// untitled markdown engine

/**
 * Simple helper to just return
 * @callback SimpleHelper
 * @returns {string} The output to change the variable with
 */

/**
 * Full helper function that is executed per request.
 * @callback FullHelper
 * @param {Object} req Express `req` object
 * @param {Object} res Express `res` object
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

/**
 * Configuration options for the ume middleware.
 *
 * @typedef {Object} UmeOptions
 * @property {string} contentDir - **Required**. Path to the directory containing .md files.
 * @property {string} templatePath - **Required**. Path to the HTML template file.
 * @property {boolean} [quiet=false] - Suppress all console output except errors.
 * @property {boolean} [verbose=false] - Enable detailed build logs (overrides quiet).
 * @property {boolean} [nextUsage=false] - When encountering a 404 or 500 error, should umejs call next() and do nothing?
 * @property {Record<string, Helper>} [helpers] - Optional extra functions that run on build or for every request
 * @property {'development' | 'production'} [mode='production'] - 'development' enables file watching.
 * @property {string} [partialsDir] - Path to partials directory. If omitted, partials are disabled.
 * @property {string} [notFoundPath] - Path to an HTML page to be served for a 404 error.
 * @property {Array<Function>} [parsers] - An array of custom functions that get passed the raw Markdown on build and should return valid Markdown
 * @property {Array<Function>} [builders] - An array of custom functions that get passed the near final HTML and should return HTML
 */

const fs = require('node:fs');
const path = require('node:path');
const { replaceAll } = require('./lib/helpers');
const { log, logError, logFatal, logWarn } = require('./lib/logger');
const { buildAllFiles, buildSingleFile, RESERVED_KEYS } = require('./lib/build');
const { setupWatcher } = require('./lib/watcher');

/**
 * umejs expressjs middleware for serving Markdown pages
 *
 * @param {UmeOptions} options
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
        notFoundPath,
        builders,
        parsers,
        nextUsage,
    } = options;

    helpers = helpers || {};
    builders = builders || [];
    mode = mode || 'production';

    const FORBIDDEN_KEYS = [...RESERVED_KEYS, ...Object.keys(helpers)];

    // if user for some reason wants quiet and loud logs, handle that
    if (quiet && verbose) {
        quiet = false;
        log('Both quiet and verbose output specified; ignoring quiet setting', 'yellow', false);
    }

    // load template
    if (!quiet) log(`Initialising project at ${contentDir}`, 'yellow', false);
    const startTime = Date.now();

    let cachedHelpers = {};
    const realtimeHelpers = {};

    // separate cached helpers and non cached helpers
    for (let [key, fn] of Object.entries(helpers)) {
        let helperFunction;
        if (typeof fn === 'object' && fn.helper) {
            helperFunction = fn.helper;
        } else {
            helperFunction = fn;
        }
        if (typeof helperFunction === 'function') {
            // run helper, use await in case its a promise
            if (typeof fn === 'object' && fn.cache) {
                cachedHelpers[key] = helperFunction;
            } else {
                realtimeHelpers[key] = helperFunction;
            }
        } else {
            logWarn(
                `Invalid helper provided (expected type function, helper is ${typeof helperFunction})`,
            );
        }
    }

    let template;
    try {
        template = fs.readFileSync(templatePath, 'utf-8');
    } catch {
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
        cachedHelpers,
        parsers,
    };

    let mdFiles = [];
    try {
        mdFiles = buildAllFiles(buildOptions);
    } catch (err) {
        logFatal(`Failed to build files: ${err.message}`);
    }

    const deltaTime = Date.now() - startTime;
    log(`All files built - took ${deltaTime}ms`, 'green', quiet);

    // * dev mode
    if (mode === 'development') {
        setupWatcher({
            contentDir,
            partialsDir,
            cache,
            buildSingleFile: (file) => buildSingleFile(file, buildOptions),
            mdFiles,
            quiet,
            verbose,
        });
    }

    // * express middleware
    return async function (req, res, next) {
        try {
            let slug = req.params.slug || req.params[0] || 'index';

            if (Array.isArray(slug)) {
                slug = slug.join('/');
            }

            // remove leading/trailing slashes if any and .md file extensions
            slug = slug.replace(/^\/|\.md(\/)*$|\/$/g, '');

            let html = cache.get(slug);

            // check if page exists
            if (!slug || !html) {
                // if user wants to do everything themselves, let them.
                if (nextUsage) {
                    next();
                    return;
                }
                // if there is a directory for the 404 page, give that
                if (notFoundPath) {
                    res.status(404).sendFile(path.resolve(notFoundPath));
                    return;
                } else {
                    // check if user perhaps has a 404.md file
                    const notFoundMd = cache.get('404');
                    if (notFoundMd) {
                        res.status(404);
                        html = notFoundMd;
                    } else {
                        // user does not, send very basic 404 page
                        res.status(404).send(`
                            <h2>umejs</h2>
                            <h1>404 - file not found</h1>
                            <p>The file you were looking for could not be found. <b>PRO TIP:</b> You can specify your own 404 page with umejs!</p>    
                        `);
                        return;
                    }
                }
            }

            let finalHtml = html;
            // replace _SLUG
            finalHtml = replaceAll(finalHtml, `{_SLUG}`, slug);

            for (let [key, fn] of Object.entries(realtimeHelpers)) {
                if (typeof fn === 'function') {
                    const dynamicValue = await fn(req, res, slug);
                    finalHtml = replaceAll(finalHtml, `{${key}}`, dynamicValue);
                } else {
                    logWarn(
                        `Invalid helper provided (expected type function, helper is ${typeof fn})`,
                    );
                }
            }

            for (const builder of builders) {
                if (typeof builder === 'function') {
                    const builderOutput = await builder(req, res, slug, finalHtml);
                    if (typeof builderOutput === 'string') {
                        finalHtml = builderOutput;
                    }
                } else {
                    logWarn(
                        `Invalid builder provided (expected type function, builder is ${typeof builder})`,
                    );
                }
            }

            await finalHtml;

            // handle any escaped characters and turn them normal
            const escapedVarRegex = /(?:{{([^}]+)}}|\\{([^}]+)})/g;
            finalHtml = finalHtml.replace(escapedVarRegex, '{$1$2}');

            // handle any escaped {_INCLUDE()} statements
            const escapedIncludeRegex =
                /(?:{{(_INCLUDE\(["'][^"']+["']\))\}}|\\{(_INCLUDE\(["'][^"']+["']\))\})/g;
            finalHtml = finalHtml.replace(escapedIncludeRegex, '{$1$2}');

            res.set('Content-Type', 'text/html');
            res.send(finalHtml);
        } catch (err) {
            logError(`Request error: ${err.message}`, quiet);
            // if user wants to do everything themselves, let them.
            if (nextUsage) {
                next(err);
            } else {
                // if not, umejs should just do something
                if (!res.headersSent) {
                    res.status(500).send('[umejs] Internal server error. Try again later.');
                }
            }
            return;
        }
    };
};
