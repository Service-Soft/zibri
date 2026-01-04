import { readFile, writeFile } from 'fs/promises';
import path from 'path';

const esmIndexJs = path.resolve('dist/esm/index.js');
const esmIndexMjs = path.resolve('dist/esm/index.mjs');
const esmIndexMapJs = `${esmIndexJs}.map`;
const esmIndexMapMjs = `${esmIndexMjs}.map`;

// eslint-disable-next-line jsdoc/require-jsdoc
async function renameEsmIndex() {
    try {
        // index
        let js = await readFile(esmIndexMjs, 'utf8');
        js = js.replace('sourceMappingURL=index.js.map', 'sourceMappingURL=index.mjs.map');
        await writeFile(esmIndexMjs, js, 'utf8');

        // index map
        const mapContent = JSON.parse(await readFile(esmIndexMapJs, 'utf8'));
        mapContent.file = path.basename(esmIndexMjs);
        await writeFile(esmIndexMapMjs, JSON.stringify(mapContent), 'utf8');
    }
    catch {}
}

renameEsmIndex();