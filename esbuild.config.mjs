// esbuild.config.js
import esbuild from 'esbuild';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

const external = ['node:*', ...Object.keys(pkg.dependencies || {})];

// Build
await esbuild
    .build({
        entryPoints: ['index.js'],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: 'dist/esm/index.mjs',
        external: external,
        target: ['node22'],
        minify: true,
        define: {
            __dirname: 'import.meta.dirname',
            __filename: 'import.meta.filename',
        },
        banner: {
            // Fix dynamic require: https://github.com/evanw/esbuild/issues/1921
            js: `globalThis.require ??= (await import('node:module')).createRequire(import.meta.url);`,
        },
    })
    .catch(() => process.exit(1));

// handle worker bundle but in cjs
await esbuild.build({
    entryPoints: ['lib/build-worker.js'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: 'dist/esm/lib/build-worker.js',
    external: external,
    target: ['node22'],
    minify: true,
});
