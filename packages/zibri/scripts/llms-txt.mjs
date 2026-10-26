/* eslint-disable jsdoc/require-jsdoc */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The pages are written for a developer and for the assistant that developer asks. An assistant
// finds the pages of a site through llms.txt, an index of each page and what it is, and reads them
// all at once in llms-full.txt (llmstxt.org). Both are built from the pages themselves, after
// typedoc, into the folder the site is published from.

const SITE_URL = 'https://service-soft.github.io/zibri';

const PAGES_URL = `${SITE_URL}/documents`;

const SUMMARY = 'Zibri is an opinionated TypeScript backend framework based on express: routes, data sources, auth, '
    + 'tenants, background work and the rest of an API, declared once and read everywhere.';

// the order of the site, which typedoc.json gives: these three first, then the rest by name
const FIRST_PAGES = ['getting-started.md', 'architecture.md', 'creating-endpoints.md'];

function resolvePages(docsDir) {
    const rest = readdirSync(docsDir).filter(name => name.endsWith('.md') && !FIRST_PAGES.includes(name)).sort();
    return [...FIRST_PAGES, ...rest].map(name => ({
        name,
        url: `${PAGES_URL}/${name.replace(/\.md$/, '')}.html`,
        content: readFileSync(path.join(docsDir, name), 'utf8').trim()
    }));
}

// the first sentence of the paragraph under the title, with links as their text. A paragraph that
// leads into a list ends where the list starts, and says so with a full stop
function resolveDescription(content) {
    const lines = content.split('\n').slice(1);
    const start = lines.findIndex(line => line.trim() !== '');
    const end = lines.findIndex((line, index) => index > start && (line.trim() === '' || /^\s*([-|]|```)/.test(line)));
    const intro = lines.slice(start, end === -1 ? undefined : end).join(' ').replaceAll(/\[([^\]]*)]\([^)]*\)/g, '$1');
    const sentence = /^(.+?\.)(\s|$)/.exec(intro);
    return (sentence?.[1] ?? intro).trim().replace(/:$/, '.');
}

export function resolveLlmsTxt(docsDir) {
    const lines = ['# Zibri', '', `> ${SUMMARY}`, '', `Every page below, whole, is in [llms-full.txt](${SITE_URL}/llms-full.txt).`, '', '## Docs', ''];
    for (const page of resolvePages(docsDir)) {
        const title = (page.content.split('\n')[0] ?? '').replace(/^# /, '');
        lines.push(`- [${title}](${page.url}): ${resolveDescription(page.content)}`);
    }
    return `${lines.join('\n')}\n`;
}

export function resolveLlmsFullTxt(docsDir) {
    return `${resolvePages(docsDir).map(page => `<!-- ${page.url} -->\n\n${page.content}`).join('\n\n---\n\n')}\n`;
}

function main() {
    const zibriDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
    const docsDir = path.join(zibriDir, 'docs');
    const outDir = path.join(docsDir, 'generated');
    writeFileSync(path.join(outDir, 'llms.txt'), resolveLlmsTxt(docsDir));
    writeFileSync(path.join(outDir, 'llms-full.txt'), resolveLlmsFullTxt(docsDir));
}

// argv[1] is undefined when this module is imported by a `--eval` script rather than run
if (process.argv[1] != undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
