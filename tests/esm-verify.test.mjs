// test/esm-verify.js
import { default as ume } from '../dist/esm/index.mjs';
import assert from 'node:assert';

// check 1: the default export must be a function
assert.strictEqual(typeof ume, 'function', 'Default export should be a function');

// check 2: it should accept exactly 1 argument (options object)
assert.strictEqual(ume.length, 1, 'It should accept one options argument');

console.log('ESM build is valid and exports correctly!');
