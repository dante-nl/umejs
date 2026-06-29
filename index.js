// ume
// untitled markdown engine

// ? what is the purpose?
// a project that runs on an endpoint that puts markdown files into an html template
// it needs to build on startup
// it's basically gcc but for html and markdwown


// ? how do i integrate
// let user define an directory
// look for template.ume.html

// ? how does it work
// 1. user defines that they want to use ume
// ume.init()
// 2. this should build directories containing template.ume.html files
// this means fetching all markdown files and making new <filename>.ume.html. this is the full html template and {MARKDOWN} replaced with the contents of the markdown file (in html)
// 3. it should then respond to for example: 
// app.use("/:name", ume("/blog/", req, res, next))
// 4. when a user visits an endpoint, ume will automatically give the right html page (if exists)
// :name would send the user <name>.ume.html

// * FINAL PURPOSE: integrate md with html into one file

const fs = require('fs');
const path = require('path');
const marked = require('marked'); // or any markdown parser
const matter = require('gray-matter');
const { styleText } = require("util")
const { replaceAll } = require("./helper/regex")

const RESERVED_KEYS = ["_BODY"]

module.exports = function ume(options) {
    let { contentDir, templatePath, quiet, verbose, helpers } = options;
    helpers = helpers || {}
    // define keys that can not be used
    const FORBIDDEN_KEYS = [...RESERVED_KEYS, ...Object.keys(helpers)];

    if(quiet && verbose) {
        // if for some reason user wants less output but more output, we need to stop them
        quiet = false
        console.log(styleText("yellow", "[umejs] Both quiet and verbose output specified; ignoring quiet setting"))
    }

    // on startup, load all files in template
    if(!quiet) console.log(styleText("yellow", "[umejs] Initiliasing project at "+contentDir))
    const template = fs.readFileSync(templatePath, 'utf-8');

    // define cache
    const cache = new Map();
    
    // fetch markdowns yay
    const mdFiles = fs.readdirSync(contentDir).filter(f => f.endsWith('.md'));
    if (verbose) console.log("[umejs] Fetching"+mdFiles.length+" Markdown file(s) in "+contentDir)

    // build all files
    for (const file of mdFiles) {
        if(verbose) console.log("[umejs] Building "+file+"...")
        const slug = path.basename(file, '.md');
        const raw = fs.readFileSync(path.join(contentDir, file), 'utf-8');

        // parse frontmatter and markdown
        const { data, content } = matter(raw);
        const htmlContent = marked.parse(content);
        
        if(verbose) console.log("[umejs] Initialising default config")
        // final content
        let finalHtml = replaceAll(template, "{_BODY}", htmlContent)
        
        // add all variables
        fmVariables = Object.entries(data)
        fmVariables.forEach(([key, value]) => {
            // check if user is using a reserved key
            if (FORBIDDEN_KEYS.includes(key)) {
                console.error(styleText("red", `[umejs] Forbidden key error: "${key}" is reserved or used as a helper in ${file}`));
                throw Error;
            }

            finalHtml = replaceAll(finalHtml, `{${key}}`, value)
            
            if(verbose) console.log("[umejs] Initialising variable "+key)
        });

        if(verbose) console.log("[umejs] Storing "+slug+" in cache.")
        cache.set(slug, finalHtml);
    }
    if (!quiet) console.log(styleText("green", "[umejs] " + mdFiles.length + " Markdown file(s) in " + contentDir + " have been generated."))
    // return the middleware
    return function (req, res, next) {
        // extract slug
        let slug = req.params.slug || req.params[0] || '';

        // if it's an array, make into one
        if (Array.isArray(slug)) {
            slug = slug.join('/');
        }

        // get basename
        const slugName = path.basename(slug);

        if (!slug) {
            return res.status(400).send('Slug is required');
        }

        const html = cache.get(slugName);

        if (!html) {
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
    };
};