# v1.2.1 [2026-07-07]

- Removed `module-sync` from package.json as it was causing issues.

# v1.2.0 [2026-07-06]

- It is now possible to add a custom Markdown parser. These functions receive the Markdown content before it has been parsed and should return new Markdown/HTML.
- umejs now also supports simply parsing `next()` when encountering a 404 error or 500 error.
- Updated the `package.json` to be a bit more competent, including things such as linting using eslint and formatting using Prettier and testing with c8.
- umejs can now be used as an ES module.
- Added TypeScript as a dev dependancy and fixed issues that popped up there.
- Improved JSDoc support.

# v1.1.0 [2026-07-03]

- Added support for `index.md` files, to serve a similar purpose as `index.html` files.
- Added support for `404.md`, to be served when the user requests a slug that can not be found

- Added further tests
