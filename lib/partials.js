// ume/lib/partials.js
// * handle partials

const fs = require('node:fs');
const { logWarn } = require('./logger');

/**
 * Process partial includes in an HTML string
 * @param {string} htmlString - The HTML string to process
 * @param {Object} ctx - The theme context
 * @param {boolean} quiet - Suppress warnings
 * @returns {string} - The processed HTML string
 */
function processPartials(htmlString, ctx, quiet = false) {
    // if no context, return same content
    if (!ctx) return htmlString;

    const regex = /(?<![{\\]){_INCLUDE\(["']([^"']+)["']\)}(?!})/g;
    // ^ only matches non-escaped strings

    return htmlString.replace(regex, (match, filename) => {
        // check inline includes from themes/user options
        if (ctx.includes && ctx.includes[filename] !== undefined) {
            return processPartials(ctx.includes[filename], ctx, quiet);
        }

        // resolve via file system (user -> themes -> fallback)
        if (ctx.resolvePartial) {
            const partialPath = ctx.resolvePartial(filename);
            if (partialPath) {
                try {
                    const content = fs.readFileSync(partialPath, 'utf-8');
                    // recursively process nested includes
                    return processPartials(content, ctx, quiet);
                } catch {
                    // fall through to warning
                }
            }
        }
        logWarn(`Partial not found: ${filename}`, quiet);
        return match;
    });
}

module.exports = {
    processPartials,
};
