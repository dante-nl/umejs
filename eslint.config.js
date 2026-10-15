const { defineConfig } = require('eslint/config');
const js = require('@eslint/js');
const globals = require('globals');

module.exports = defineConfig([
    {
        ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
        files: ['**/*.{js,mjs,cjs}'],
        plugins: { js },
        extends: ['js/recommended'],
        languageOptions: {
            globals: {
                process: 'readonly',
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            'no-control-regex': 0,
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
    },
    { files: ['**/*.js'], languageOptions: { sourceType: 'commonjs' } },
]);
