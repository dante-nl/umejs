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

module.exports = function ume(options) {
    const { contentDir, templatePath } = options;

    // 1. Load the template ONCE at startup
    const template = fs.readFileSync(templatePath, 'utf-8');

    // 2. Build the cache ONCE at startup (This is your "build" step)
    const cache = new Map();
    const mdFiles = fs.readdirSync(contentDir).filter(f => f.endsWith('.md'));

    for (const file of mdFiles) {
        const slug = path.basename(file, '.md');
        const raw = fs.readFileSync(path.join(contentDir, file), 'utf-8');

        // Parse frontmatter and markdown
        const { data, content } = matter(raw);
        const htmlContent = marked.parse(content);

        // Replace placeholders in the template
        let finalHtml = template
            .replace(/{TITLE}/g, data.title || slug)
            .replace(/{DATE}/g, data.date || '')
            .replace(/{BODY}/g, htmlContent);

        cache.set(slug, finalHtml);
    }

    // 3. Return the Express Middleware
    return function (req, res, next) {
        // Extract slug safely
        // 1. Grab the param (it might be a string or an array)
        let slug = req.params.slug || req.params[0] || '';

        // 2. If it's an array (Express 5 edge case), join it into a single string
        if (Array.isArray(slug)) {
            slug = slug.join('/');
        }

        // 3. Now safely get the basename

        console.log('req.params:', req.params);
        console.log('slug value:', slug, 'type:', typeof slug);
        
        const slugName = path.basename(slug);

        if (!slug) {
            return res.status(400).send('Slug is required');
        }

        const html = cache.get(slugName);

        if (!html) {
            return res.status(404).send('Post not found');
        }

        res.set('Content-Type', 'text/html');
        res.send(html);
    };
};