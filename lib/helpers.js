const path = require('path');
const fs = require('node:fs');

/**
 * Escapes a string into a RegExp safe, escaped string
 * @param {string} string String to escape
 * @returns {string} Escaped string
 */
const escapeRegExp = (string) => {
    return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
};
/**
 * Global search using RegExp, where it can be used with any string
 * @param {string} str String to look through
 * @param {string} search String to find
 * @param {string} replacement String of which to replace `search` with
 * @returns {string} Replaced string
 */
const replaceAll = (str, search, replacement) => {
    return str.replace(
        new RegExp('(?<![{\\\\])' + escapeRegExp(search) + '(?!})', 'g'),
        replacement,
    );
};

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

module.exports = { escapeRegExp, replaceAll, getAllMarkdownFiles };
