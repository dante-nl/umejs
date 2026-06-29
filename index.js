// ume
// untitled markdown engine

const fs = require('fs');
const path = require('path');
const marked = require('marked'); // or any markdown parser
const matter = require('gray-matter');
const { styleText } = require("util")
const { replaceAll } = require("./helper/regex")

const RESERVED_KEYS = ["_BODY"]

module.exports = function ume(options) {
    let { contentDir, templatePath, quiet, verbose, helpers, mode } = options;
    helpers = helpers || {}
    // define where to use it
    // if dev mode, files should be automatically watched
    mode = mode || "production"

    // define keys that can not be used
    const FORBIDDEN_KEYS = [...RESERVED_KEYS, ...Object.keys(helpers)];

    if(quiet && verbose) {
        // if for some reason user wants less output but more output, we need to stop them
        quiet = false
        console.log(styleText("yellow", "[umejs] Both quiet and verbose output specified; ignoring quiet setting"))
    }

    // on startup, load all files in template
    // (if it exists...)
    if(!quiet) console.log(styleText("yellow", "[umejs] Initiliasing project at "+contentDir))
    let template;
    try {
        template = fs.readFileSync(templatePath, 'utf-8');
    } catch (err) {
        console.error(styleText("red", `[umejs] FATAL: Template file not found at ${templatePath}`));
        process.exit(1);
    }

    // define cache
    const cache = new Map();
    
    // fetch markdowns yay
    let mdFiles;
    try {
        mdFiles = fs.readdirSync(contentDir).filter(f => f.endsWith('.md'));
    } catch (err) {
        console.error(styleText("red", `[umejs] FATAL: Content directory not found at ${contentDir}`));
        process.exit(1);
    }
    if (verbose) console.log("[umejs] Fetching"+mdFiles.length+" Markdown file(s) in "+contentDir)

    function buildSingleFile(file) {
        if (verbose) console.log("[umejs] Building " + file + "...")

        const slug = path.basename(file, '.md');
        const raw = fs.readFileSync(path.join(contentDir, file), 'utf-8');

        // get frontmatter and markdown
        const { data, content } = matter(raw);
        const htmlContent = marked.parse(content);

        let finalHtml = replaceAll(template, "{_BODY}", htmlContent);

        // parse variables
        for (const [key, value] of Object.entries(data)) {
            if (verbose) console.log("[umejs] Initialising variable " + key)
            if (FORBIDDEN_KEYS.includes(key)) {
                console.error(styleText("red", `[umejs] Forbidden key error: "${key}" is reserved or used as a helper in ${file}`));
                throw Error;
            }
            finalHtml = replaceAll(finalHtml, `{${key}}`, value);
        }

        if (verbose) console.log("[umejs] Storing " + slug + " in cache.")
        cache.set(slug, finalHtml);
        if (!quiet) console.log(`[umejs] Built ${file}`);
    }
    // build files
    const mdFiles = fs.readdirSync(contentDir).filter(f => f.endsWith('.md'));
    for (const file of mdFiles) {
        try {
            buildSingleFile(file);
        } catch(err) {
            console.error(styleText("red", `[umejs] ERROR: Skipping ${file}; ${err.message}`));
            continue
        }
    }

    if (!quiet) console.log(styleText("green", "[umejs] " + mdFiles.length + " Markdown file(s) in " + contentDir + " have been generated."))
    
    // dev mode to watch for changes
    if (mode === 'development') {
        let timeout = null;
        fs.watch(contentDir, { recursive: true }, (event, filename) => {
            if (!filename || !filename.endsWith('.md')) return;

            // Debounce: rapid save events can fire twice
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                if (!quiet) console.log(`[umejs] Detected change in ${filename}, rebuilding...`);
                buildSingleFile(filename);
                timeout = null;
            }, 150);
        });

        if (!quiet) console.log(styleText("yellow", "[umejs] Dev mode active. Watching for Markdown changes..."));
    }
    // return the middleware
    return function (req, res, next) {
        try {
            // extract slug
            let slug = req.params.slug || req.params[0] || '';
    
            // if it's an array, make into one
            if (Array.isArray(slug)) {
                slug = slug.join('/');
            }
    
            // get basename
            const slugName = path.basename(slug);
            const html = cache.get(slugName);
    
            if (!slug || !html) {
                return res.status(404).send('Post not found');
            }
    
            // add user defined helper functions
            let finalHtml = html;
            for (const [key, fn] of Object.entries(helpers)) {
                if (typeof fn === 'function') {
                    // execute the function and pass useful context (req, res, slug)
                    const dynamicValue = fn(req, res, slugName);
                    finalHtml = replaceAll(finalHtml, `{${key}}`, dynamicValue);
                }
            }
    
            res.set('Content-Type', 'text/html');
            res.send(finalHtml);
        } catch (err) {
            console.error('[umejs] Request error:', err.message);
            res.status(500).send('Internal server error');
        }
    };
};