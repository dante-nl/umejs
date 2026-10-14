// ume/lib/logger.js
// * logging utilities

const { styleText } = require('util');

/**
 * A `util.styleText` format: a single colour name, a list of names, or a
 * hex colour like `"#ff00ff"`. Derived from `styleText` itself so it stays
 * in sync with whatever `@types/node` ships
 *
 * @typedef {Parameters<typeof styleText>[0]} Style
 */

/**
 * Level labels for each log kind.
 *
 * @typedef {Object} LoggerLabels
 * @property {string} error
 * @property {string} warn
 * @property {string} fatal
 */

/**
 * Message style per log level.
 *
 * @typedef {Object} LoggerStyles
 * @property {Style|null} info
 * @property {Style|null} error
 * @property {Style|null} warn
 * @property {Style|null} fatal
 */

/**
 * Global logger configuration
 *
 * @typedef {Object} LoggerConfig
 * @property {string} prefix Tag shown at the start of every line.
 * @property {Style|null} prefixStyle Style applied to Loggerconfig.prefix.
 * @property {string} separator Text inserted between each part of a line.
 * @property {LoggerLabels} labels Level labels (e.g. `"ERROR:"`).
 * @property {LoggerStyles} styles Message style per level.
 * @property {Style|null} labelStyle Style applied to the level labels.
 * @property {Style|null} defaultStyle Fallback style for plain `log()` calls.
 */

/** @type {LoggerConfig} */
const config = {
    prefix: '[🌸 umejs]',
    prefixStyle: ['magentaBright', 'bold'],
    separator: ' ',
    labels: {
        error: 'ERROR:',
        warn: 'WARNING:',
        fatal: 'FATAL:',
    },
    styles: {
        info: null,
        error: 'red',
        warn: 'yellow',
        fatal: 'red',
    },
    labelStyle: null,
    defaultStyle: null,
};

/**
 * Shallow-merge new values into config. The nested `labels` and
 * `styles` objects are merged one level deep, so you can override a single
 * key without replacing the whole object.
 *
 * @param {Partial<LoggerConfig>} [overrides]
 * @returns {typeof config} The updated config.
 */
function configure(overrides = {}) {
    Object.assign(config, overrides, {
        labels: { ...config.labels, ...(overrides.labels ?? {}) },
        styles: { ...config.styles, ...(overrides.styles ?? {}) },
    });
    return config;
}

/**
 * Build a formatted log line from its parts. Each part is styled
 * independently so the prefix colour survives regardless of the message colour.
 *
 * @param {string} message
 * @param {Object} [opts]
 * @param {Style|null} [opts.style] Style for the message text.
 * @param {string|null} [opts.label] Optional level label (e.g. `"ERROR:"`).
 * @param {Style|null} [opts.labelStyle] Per-call override for {@link config.labelStyle}.
 * @returns {string}
 */
function formatLine(message, { style = null, label = null, labelStyle } = {}) {
    const prefixStyle = config.prefixStyle;
    const resolvedLabelStyle = labelStyle ?? config.labelStyle;

    const parts = [prefixStyle ? styleText(prefixStyle, config.prefix) : config.prefix];

    if (label) {
        parts.push(resolvedLabelStyle ? styleText(resolvedLabelStyle, label) : label);
    }

    parts.push(style ? styleText(style, message) : message);
    return parts.join(config.separator);
}

/**
 * Log a message with optional styling.
 * @param {string} message - The message to log
 * @param {Style|null} [color] - Style for the message (e.g. `"green"`)
 * @param {boolean} [quiet] - If true, suppress logging
 */
function log(message, color = null, quiet = false) {
    if (quiet) return;
    console.log(formatLine(message, { style: color ?? config.defaultStyle }));
}

/**
 * Log an error message.
 * @param {string} message - The error message
 * @param {boolean} [quiet] - If true, suppress logging
 */
function logError(message, quiet = false) {
    if (quiet) return;
    console.error(
        formatLine(message, {
            label: config.labels.error,
            style: config.styles.error,
        }),
    );
}

/**
 * Log a warning message.
 * @param {string} message - The warning message
 * @param {boolean} [quiet] - If true, suppress logging
 */
function logWarn(message, quiet = false) {
    if (quiet) return;
    console.warn(
        formatLine(message, {
            label: config.labels.warn,
            style: config.styles.warn,
        }),
    );
}

/**
 * Log a fatal error and exit.
 * @param {string} message - The fatal error message
 */
function logFatal(message) {
    console.error(
        formatLine(message, {
            label: config.labels.fatal,
            style: config.styles.fatal,
        }),
    );
    process.exit(1);
}

module.exports = {
    log,
    logError,
    logWarn,
    logFatal,
    config,
    configure,
};
