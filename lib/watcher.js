// ume/lib/watcher.js
// * dev mode file watching

const fs = require('node:fs');
const path = require('node:path');
const { log, logWarn, logError } = require('./logger');

/**
 * Set up file watching for development mode
 * @param {Object} options - Watcher options
 * @param {string} options.contentDir - Directory containing .md files
 * @param {Map} options.cache - The cache
 * @param {Function} options.buildSingleFile - Function to rebuild a single file
 * @param {Array<string>} options.mdFiles - List of all Markdown files (will be updated)
 * @param {string|null} [options.partialsDir] - Directory containing partials (null = disabled)
 * @param {boolean} [options.quiet] - Suppress logs
 * @param {boolean} [options.verbose] - Enable detailed logs
 * @returns {fs.FSWatcher}
 */
function setupWatcher(options) {
    let { contentDir, partialsDir, cache, buildSingleFile, mdFiles, quiet, verbose } = options;

    // calculate partials relative path for detection
    let partialsRelativePath = null;
    if (partialsDir) {
        const relPath = path.relative(contentDir, partialsDir);
        // if relPath starts with '..', partialsDir is outside contentDir
        if (relPath.startsWith('..')) {
            logWarn(
                `partialsDir (${partialsDir}) is outside contentDir (${contentDir}). ` +
                    `Changes to partials will NOT be auto-detected in dev mode.`,
                quiet,
            );
        } else {
            // normalize to use forward slashes for stupid windows
            partialsRelativePath = relPath.split(path.sep).join('/');
        }
    }

    let timeout = null;

    const watcher = fs.watch(contentDir, { recursive: true }, (event, filename) => {
        if (!filename) return;

        // normalize filename to forward slashes for consistent checking
        const normalizedFilename = filename.split(path.sep).join('/');

        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
            // handle creation and deletion of files
            if (event === 'rename' || event === 'change') {
                const absolutePath = path.join(contentDir, normalizedFilename);

                // 👇 NEW: Check if this is an overwrite of an existing .md file
                if (normalizedFilename.endsWith('.md') && fs.existsSync(absolutePath)) {
                    // Existing .md file was overwritten -> rebuild it
                    if (!quiet) log(`Detected change in ${filename}, rebuilding...`, 'cyan', false);
                    try {
                        buildSingleFile(filename);
                    } catch (err) {
                        logError(`Failed to rebuild ${filename}; ${err.message}`, quiet);
                    }
                    timeout = null;
                    return;
                }

                const isPartial =
                    partialsRelativePath &&
                    normalizedFilename.startsWith(partialsRelativePath + '/');
                if (isPartial && fs.existsSync(absolutePath)) {
                    if (!quiet)
                        log(
                            `Partial changed (${filename}), rebuilding all pages...`,
                            'cyan',
                            false,
                        );
                    for (const file of mdFiles) {
                        try {
                            buildSingleFile(file);
                        } catch (err) {
                            logError(`Skipping ${file}; ${err.message}`, quiet);
                        }
                    }
                    timeout = null;
                    return;
                }

                // Re-scan contentDir for .md files
                const newMdFiles = fs.readdirSync(contentDir).filter((f) => f.endsWith('.md'));
                // Check if the list actually changed
                const changed =
                    newMdFiles.length !== mdFiles.length ||
                    !newMdFiles.every((f) => mdFiles.includes(f));
                if (changed) {
                    mdFiles = newMdFiles;
                    if (!quiet) log('File list changed, rebuilding all pages...', 'cyan', false);
                    // rebuild all existing files
                    for (const file of mdFiles) {
                        try {
                            buildSingleFile(file);
                        } catch (err) {
                            logError(`Skipping ${file}; ${err.message}`, quiet);
                        }
                    }
                    // remove cache entries for files that no longer exist
                    for (const key of cache.keys()) {
                        if (!mdFiles.includes(key + '.md')) {
                            cache.delete(key);
                            if (verbose) log(`Removed ${key} from cache`, null, false);
                        }
                    }
                }
                timeout = null;
                return;
            }
        }, 150);
    });

    if (!quiet) {
        log('Dev mode active. Watching for changes...', 'yellow', false);
    }

    return watcher;
}

module.exports = {
    setupWatcher,
};
