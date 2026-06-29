// ume/lib/logger.js
// * logging utilities

const { styleText } = require("util");

const PREFIX = "[umejs]";

/**
 * Log a message with optional styling
 * @param {string} message - The message to log
 * @param {string} [color] - The color to use (yellow, red, green, cyan)
 * @param {boolean} [quiet] - If true, suppress logging
 */
function log(message, color = null, quiet = false) {
    if (quiet) return;
    const styled = color ? styleText(color, `${PREFIX} ${message}`) : `${PREFIX} ${message}`;
    console.log(styled);
}

/**
 * Log an error message
 * @param {string} message - The error message
 * @param {boolean} [quiet] - If true, suppress logging
 */
function logError(message, quiet = false) {
    if (quiet) return;
    console.error(styleText("red", `${PREFIX} ERROR: ${message}`));
}

/**
 * Log a warning message
 * @param {string} message - The warning message
 * @param {boolean} [quiet] - If true, suppress logging
 */
function logWarn(message, quiet = false) {
    if (quiet) return;
    console.warn(styleText("yellow", `${PREFIX} WARNING: ${message}`));
}

/**
 * Log a fatal error and exit
 * @param {string} message - The fatal error message
 */
function logFatal(message) {
    console.error(styleText("red", `${PREFIX} FATAL: ${message}`));
    process.exit(1);
}

module.exports = {
    log,
    logError,
    logWarn,
    logFatal
};