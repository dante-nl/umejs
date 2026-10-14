const { marked } = require('marked');
const workerpool = require('workerpool');

/**
 * Lex and parse a Markdown string into tokens and HTML.
 * Runs entirely inside a worker thread.
 * @param {string} markdown
 * @returns {{ tokens: object[], html: string }}
 */
function lexAndParse(markdown) {
    const tokens = marked.lexer(markdown);
    const html = marked.parser(tokens);
    return { tokens, html };
}

workerpool.worker({
    lexAndParse,
});
