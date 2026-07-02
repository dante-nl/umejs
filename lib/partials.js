// ume/lib/partials.js
// * handle partials

const fs = require('fs');
const path = require('path');
const { logWarn } = require('./logger');

/**
 * Process partial includes in an HTML string
 * @param {string} htmlString - The HTML string to process
 * @param {string|null} partialsDir - The directory containing partials (null = disabled)
 * @param {boolean} quiet - Suppress warnings
 * @returns {string} - The processed HTML string
 */
function processPartials(htmlString, partialsDir, quiet = false) {
    // if no partials directory, return same content
    if (!partialsDir) return htmlString;

    const regex = /(?<![{\\]){_INCLUDE\(["']([^"']+)["']\)}(?!})/g;
    // ^ only matches non-escaped strings

    return htmlString.replace(regex, (match, filename) => {
        // prevent directory traversal
        const safeFilename = path.basename(filename);
        const partialPath = path.join(partialsDir, safeFilename);

        try {
            const content = fs.readFileSync(partialPath, 'utf-8');
            // recursively process nested includes
            return processPartials(content, partialsDir, quiet);
        } catch (err) {
            logWarn(`Partial not found: ${filename}`, quiet);
            return match;
        }
    });
}

module.exports = {
    processPartials
};