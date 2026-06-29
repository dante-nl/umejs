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
const { replaceAll } = require('./lib/helpers');
const { log, logError, logFatal, logWarn } = require('./lib/logger');
const { buildAllFiles, buildSingleFile, RESERVED_KEYS } = require('./lib/build');
const { setupWatcher } = require('./lib/watcher');

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
        log("Both quiet and verbose output specified; ignoring quiet setting", "yellow", false);
    }

    // load template
    if (!quiet) log(`Initialising project at ${contentDir}`, "yellow", false);

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
        verbose
    };

    let mdFiles = [];
    try {
        mdFiles = buildAllFiles(buildOptions);
    } catch (err) {
        logFatal(`Failed to build files: ${err.message}`);
    }

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
            logError(`Request error: ${err.message}`, quiet);
            res.status(500).send('Internal server error');
        }
    };
};