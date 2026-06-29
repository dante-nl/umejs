// ume/lib/watcher.js
// * dev mode file watching

const fs = require('fs');
const path = require('path');
const { log, logWarn, logError } = require('./logger');

/**
 * Set up file watching for development mode
 * @param {Object} options - Watcher options
 * @param {string} options.contentDir - Directory containing .md files
 * @param {string|null} options.partialsDir - Directory containing partials (null = disabled)
 * @param {Map} options.cache - The cache (not directly used, but passed for context)
 * @param {Function} options.buildSingleFile - Function to rebuild a single file
 * @param {Function} options.buildAllFiles - Function to rebuild all files
 * @param {Array<string>} options.mdFiles - List of all Markdown files
 * @param {boolean} options.quiet - Suppress logs
 * @param {boolean} options.verbose - Enable detailed logs
 * @returns {void}
 */
function setupWatcher(options) {
    const {
        contentDir,
        partialsDir,
        buildSingleFile,
        buildAllFiles,
        mdFiles,
        quiet,
        verbose
    } = options;

    // calculate partials relative path for detection
    let partialsRelativePath = null;
    if (partialsDir) {
        const relPath = path.relative(contentDir, partialsDir);
        // if relPath starts with '..', partialsDir is outside contentDir
        if (relPath.startsWith('..')) {
            logWarn(
                `partialsDir (${partialsDir}) is outside contentDir (${contentDir}). ` +
                `Changes to partials will NOT be auto-detected in dev mode.`,
                quiet
            );
        } else {
            // normalize to use forward slashes for stupid windows
            partialsRelativePath = relPath.split(path.sep).join('/');
        }
    }

    let timeout = null;

    fs.watch(contentDir, { recursive: true }, (event, filename) => {
        if (!filename) return;

        // normalize filename to forward slashes for consistent checking
        const normalizedFilename = filename.split(path.sep).join('/');

        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
            // check if the changed file is inside the partials directory
            const isPartial = partialsRelativePath &&
                normalizedFilename.startsWith(partialsRelativePath + '/');

            // if it's a partial, update all pages
            if (isPartial) {
                if (!quiet) log(`Partial changed (${filename}), rebuilding all pages...`, "cyan", false);
                for (const file of mdFiles) {
                    try {
                        buildSingleFile(file);
                    } catch (err) {
                        logError(`Skipping ${file}; ${err.message}`, quiet);
                    }
                }
            }

            // rebuild regular old markdown files
            else if (filename.endsWith('.md')) {
                if (!quiet) log(`Detected change in ${filename}, rebuilding...`, "cyan", false);
                try {
                    buildSingleFile(filename);
                } catch (err) {
                    logError(`Failed to rebuild ${filename}; ${err.message}`, quiet);
                }
            }

            timeout = null;
        }, 150);
    });

    if (!quiet) {
        log("Dev mode active. Watching for changes...", "yellow", false);
    }
}

module.exports = {
    setupWatcher
};