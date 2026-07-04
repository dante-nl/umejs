// eslint.config.js
const { defineConfig } = require('eslint/config');
const js = require('@eslint/js');
const globals = require('globals');

module.exports = defineConfig([
    {
        files: ['**/*.{js,mjs,cjs}'],
        plugins: { js },
        extends: ['js/recommended'],
        languageOptions: {
            globals: {
                process: 'readonly',
                ...globals.browser,
            },
        },
    },
    { files: ['**/*.js'], languageOptions: { sourceType: 'commonjs' } },
]);
