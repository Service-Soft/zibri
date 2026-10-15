import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { defineProvider } from '../../di/models/di-provider.model';
import { HttpStatus } from '../../http/http-status.enum';
import { KnownHeader } from '../../http/known-header.enum';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { testFileFolder } from '../constants';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../test-server/providers';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md section 3.12.
 *
 * The finding reads the static middleware's missing options as "no cache headers". What a browser
 * does with an asset is decided by what the response says, so these ask the server rather than read
 * its setup: whether a browser is told to ask again before reusing a file, whether asking again costs
 * the file or only a confirmation, and whether a file that changed is what it gets next.
 */

let server: StartedTestServer | undefined;
let baseUrl: string;

const assetsPath: FsPath = FsUtilities.getPath(testFileFolder, 'static-assets');
const publicAssetsPath: FsPath = FsUtilities.getPath(assetsPath, 'public');

/**
 * Large enough that the compression middleware's threshold does not decide the case for it.
 */
const stylesheet: string = `body { color: black; }\n${'.row { margin: 0; }\n'.repeat(200)}`;

/**
 * Asks for a file again the way a browser does once it holds a copy.
 * @param path - The path of the file.
 * @param etag - The validator the copy came with.
 * @returns The response.
 */
async function revalidate(path: string, etag: string | null): Promise<Response> {
    return await fetch(`${baseUrl}${path}`, {
        headers: {
            'if-none-match': etag ?? '',
            // node's fetch adds `cache-control: no-cache` by itself to a request carrying a
            // conditional header, which asks for the whole file whatever the validator says - so a
            // 200 would be the right answer to it. A browser sends this instead
            'cache-control': 'max-age=0'
        }
    });
}

beforeAll(async () => {
    await FsUtilities.mkdir(FsUtilities.getPath(publicAssetsPath, 'eval-static'));
    await FsUtilities.createFile(FsUtilities.getPath(publicAssetsPath, 'eval-static', 'style.css'), stylesheet);
    await FsUtilities.createFile(FsUtilities.getPath(publicAssetsPath, 'favicon.png'), 'fake-favicon-bytes');
    server = await startTestServer({
        // in process: nothing here is stored, and a container would be most of what the suite costs
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.ASSETS_PATH, useValue: assetsPath })
        ]
    });
    baseUrl = await server.start();
}, 30000);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(assetsPath);
}, 30000);

describe('evaluation/04-infrastructure-subsystems', () => {

    describe('3.12 - static assets and caching', () => {

        it('tells a browser to confirm an asset before reusing it, and gives it what to confirm with', async () => {
            const res: Response = await fetch(`${baseUrl}/assets/eval-static/style.css`);

            expect(res.status).toBe(HttpStatus.OK);
            // a file name that says nothing about its content has to be asked about again, or a
            // browser goes on using the old stylesheet after a deploy for as long as it was told to
            expect(res.headers.get(KnownHeader.CACHE_CONTROL)).toMatch(/max-age=0|no-cache/);
            expect(res.headers.get('etag')).toBeTruthy();
            expect(res.headers.get('last-modified')).toBeTruthy();
        });

        it('answers an asset the browser already holds with a confirmation rather than the file', async () => {
            const first: Response = await fetch(`${baseUrl}/assets/eval-static/style.css`);
            const etag: string | null = first.headers.get('etag');
            expect(etag).toBeTruthy();

            const again: Response = await revalidate('/assets/eval-static/style.css', etag);

            expect(again.status).toBe(HttpStatus.NOT_MODIFIED);
            await expect(again.text()).resolves.toBe('');
        });

        it('serves a changed asset rather than the one the browser holds', async () => {
            const first: Response = await fetch(`${baseUrl}/assets/eval-static/style.css`);
            const etag: string | null = first.headers.get('etag');
            const changed: string = `${stylesheet}.changed { margin: 1px; }\n`;
            await FsUtilities.updateFile(FsUtilities.getPath(publicAssetsPath, 'eval-static', 'style.css'), changed, 'replace');

            const again: Response = await revalidate('/assets/eval-static/style.css', etag);

            expect(again.status).toBe(HttpStatus.OK);
            await expect(again.text()).resolves.toBe(changed);
        });

        it('answers the favicon the same way, although it is a route rather than the static middleware', async () => {
            // the finding names this route for the stat it makes per request - which is what reading
            // a validator off the file costs, the static middleware included. What would matter is a
            // route that sent the file every time
            const first: Response = await fetch(`${baseUrl}/favicon.ico`);
            expect(first.status).toBe(HttpStatus.OK);
            expect(first.headers.get(KnownHeader.CACHE_CONTROL)).toMatch(/max-age=0|no-cache/);
            const etag: string | null = first.headers.get('etag');
            expect(etag).toBeTruthy();

            const again: Response = await revalidate('/favicon.ico', etag);

            expect(again.status).toBe(HttpStatus.NOT_MODIFIED);
        });

        it('compresses an asset for a client that reads brotli', async () => {
            const res: Response = await fetch(`${baseUrl}/assets/eval-static/style.css`, {
                headers: { 'accept-encoding': 'br' }
            });

            expect(res.status).toBe(HttpStatus.OK);
            expect(res.headers.get(KnownHeader.CONTENT_ENCODING)).toBe('br');
            // decoded by fetch on the way in, so this is the file rather than its encoding
            await expect(res.text()).resolves.toContain('body { color: black; }');
        });
    });
});