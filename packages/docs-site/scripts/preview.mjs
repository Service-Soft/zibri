import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Serves the exported site as GitHub Pages does: the folder of the export at /zibri/, a folder answered with its
// index.html, and nothing else. What it shows is what is published, without the site running behind it.

const EXPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.generated');
const BASE_PATH = '/zibri/';
const PORT = Number(process.env.PORT ?? '4000');

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2'
};

function resolveFile(pathname) {
    if (!pathname.startsWith(BASE_PATH)) {
        return undefined;
    }
    const file = path.join(EXPORT_DIR, decodeURIComponent(pathname.slice(BASE_PATH.length)));
    // nothing outside the export
    if (!file.startsWith(EXPORT_DIR) || !existsSync(file)) {
        return undefined;
    }
    if (!statSync(file).isDirectory()) {
        return file;
    }
    const index = path.join(file, 'index.html');
    return existsSync(index) ? index : undefined;
}

if (!existsSync(EXPORT_DIR)) {
    // eslint-disable-next-line no-console
    console.error(`There is no export at ${EXPORT_DIR}. Run "npm run build" and "npm run export" first.`);
    process.exit(1);
}

createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    // a folder without its slash is sent on to it, as GitHub Pages does, so the links of its page resolve
    const file = resolveFile(pathname);
    if (file?.endsWith('index.html') === true && !pathname.endsWith('/') && !pathname.endsWith('.html')) {
        response.writeHead(301, { location: `${pathname}/` });
        response.end();
        return;
    }
    if (file === undefined) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
    }
    response.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
}).listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.info(`The exported site is at http://localhost:${PORT}${BASE_PATH}`);
});