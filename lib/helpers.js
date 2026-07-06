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

module.exports = { escapeRegExp, replaceAll };
