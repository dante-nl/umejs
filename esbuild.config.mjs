// esbuild.config.js
import esbuild from 'esbuild';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

const external = [
    'node:*',
    ...Object.keys(pkg.dependencies || {}),
];

// Build
await esbuild.build({
    entryPoints: ['index.js'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: 'dist/esm/index.mjs',
    external: external,
    target: ['node22.13.0'],
    minify: true,
    banner: {
        // Fix dynamic require: https://github.com/evanw/esbuild/issues/1921
        js: `globalThis.require ??= (await import('node:module')).createRequire(import.meta.url);`
    },
}).catch(() => process.exit(1));