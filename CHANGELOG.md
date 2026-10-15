# v1.3.0 [2026-10-15]

**Breaking change**:

- umejs is now async by default, so it will no longer block Express' `app.listen()`. The build is lazily resolved on first request. If any of your code relied on this behaviour of blocking the main thread (e.g. any code that _has_ to run after umejs is done loading), please [`ume.ready()`](https://ume.dantenl.com/v1/ume-ready)

**Other changes**:

- umejs can now cache your files, resulting in faster and more performant start-ups! It won't affect first startups much, but every subsequent one (provided no content changes) goes from about 50ms to just around 10ms!
    - Alongside this, the configuration option `cachePath` was added; this allows you to either disable caching (set it to `false`) or set it to a custom file name and/or directory.
- Added an experimental toggle for building your files in parallel! This can improve performance on larger projects. On smaller projects, improvements will be negligible. You can enable this by adding `parallel: true` to your umejs options. In the future, this is likely to become default behaviour. It utilises the module workerpool to lex the Markdown files across multiple CPU cores.
- Updated the default formatter and formatting to feature some pink because I like that. Also added a cute 🌸 (cherry blossom) emoji because it's one of my favourites.
- Added `middleware.ready`, a promise that is resolved to the list of built files.
- Replaced dependancy [gray-matter](https://www.npmjs.com/package/gray-matter) (responsible for parsing Frontmatter) with [node-markdown-frontmatter-parser](https://www.npmjs.com/package/markdown-frontmatter-parser), due to lack of maintenance and security concerns.
- Added extra tests, primarily ones related to the async building.

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
