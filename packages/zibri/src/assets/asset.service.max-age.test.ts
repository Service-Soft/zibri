import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { DiProvider, defineProvider } from '../di/models/di-provider.model';
import { HttpStatus } from '../http/http-status.enum';
import { KnownHeader } from '../http/known-header.enum';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';

const assetsPath: FsPath = FsUtilities.getPath(testFileFolder, 'asset-max-age');
const publicAssetsPath: FsPath = FsUtilities.getPath(assetsPath, 'public');

/**
 * Large enough that the compression middleware's threshold does not decide the case for it.
 */
const stylesheet: string = `body { color: black; }\n${'.row { margin: 0; }\n'.repeat(200)}`;

/**
 * Starts a server serving the assets of this file.
 * @param providers - What it is started with besides the defaults.
 * @returns The server and where it is reachable.
 */
async function startAssetServer(providers: DiProvider<unknown>[]): Promise<{ server: StartedTestServer, baseUrl: string }> {
    const server: StartedTestServer = await startTestServer({
        // each describe boots one of them, and a declared data source a boot leaves out refuses that
        // boot unless it may be an orphan
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories, allowOrphan: true })],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.ASSETS_PATH, useValue: assetsPath }),
            ...providers
        ]
    });
    return { server, baseUrl: await server.start() };
}

beforeAll(async () => {
    await FsUtilities.createFile(FsUtilities.getPath(publicAssetsPath, 'logo.svg'), '<svg/>', true);
    await FsUtilities.createFile(FsUtilities.getPath(publicAssetsPath, 'styles', 'style.css'), stylesheet, true);
    await FsUtilities.createFile(FsUtilities.getPath(publicAssetsPath, 'favicon.png'), 'favicon', true);
});

afterAll(async () => {
    await FsUtilities.rm(assetsPath);
});

describe('the public assets max age', () => {
    let server: StartedTestServer | undefined;
    let baseUrl: string = '';

    beforeAll(async () => {
        ({ server, baseUrl } = await startAssetServer([defineProvider({ token: ZIBRI_DI_TOKENS.PUBLIC_ASSETS_MAX_AGE_IN_MS, useValue: Ms.DAY })]));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it.each(['/assets/logo.svg', '/favicon.ico'])('lets a browser keep %s for as long as it says', async path => {
        const res: Response = await fetch(`${baseUrl}${path}`);

        expect(res.status).toBe(200);
        expect(res.headers.get(KnownHeader.CACHE_CONTROL)).toBe('public, max-age=86400');
    });
});

// what a browser does with an asset is decided by what the response says, so these ask the server:
// whether a browser is told to ask again before reusing a file, whether asking again costs the file or
// only a confirmation, and whether a file that changed is what it gets next
describe('the public assets without a max age', () => {
    let server: StartedTestServer | undefined;
    let baseUrl: string = '';

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
        ({ server, baseUrl } = await startAssetServer([]));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('tells a browser to confirm an asset before reusing it, and gives it what to confirm with', async () => {
        const res: Response = await fetch(`${baseUrl}/assets/styles/style.css`);

        expect(res.status).toBe(HttpStatus.OK);
        // a file name that says nothing about its content has to be asked about again, or a browser
        // goes on using the old stylesheet after a deploy for as long as it was told to
        expect(res.headers.get(KnownHeader.CACHE_CONTROL)).toMatch(/max-age=0|no-cache/);
        expect(res.headers.get('etag')).toBeTruthy();
        expect(res.headers.get('last-modified')).toBeTruthy();
    });

    it('answers an asset the browser already holds with a confirmation rather than the file', async () => {
        const first: Response = await fetch(`${baseUrl}/assets/styles/style.css`);
        const etag: string | null = first.headers.get('etag');
        expect(etag).toBeTruthy();

        const again: Response = await revalidate('/assets/styles/style.css', etag);

        expect(again.status).toBe(HttpStatus.NOT_MODIFIED);
        await expect(again.text()).resolves.toBe('');
    });

    it('serves a changed asset rather than the one the browser holds', async () => {
        const first: Response = await fetch(`${baseUrl}/assets/styles/style.css`);
        const etag: string | null = first.headers.get('etag');
        const changed: string = `${stylesheet}.changed { margin: 1px; }\n`;
        await FsUtilities.updateFile(FsUtilities.getPath(publicAssetsPath, 'styles', 'style.css'), changed, 'replace');

        const again: Response = await revalidate('/assets/styles/style.css', etag);

        expect(again.status).toBe(HttpStatus.OK);
        await expect(again.text()).resolves.toBe(changed);
    });

    it('answers the favicon the same way, although it is a route rather than the static middleware', async () => {
        const first: Response = await fetch(`${baseUrl}/favicon.ico`);
        expect(first.status).toBe(HttpStatus.OK);
        expect(first.headers.get(KnownHeader.CACHE_CONTROL)).toMatch(/max-age=0|no-cache/);
        const etag: string | null = first.headers.get('etag');
        expect(etag).toBeTruthy();

        const again: Response = await revalidate('/favicon.ico', etag);

        expect(again.status).toBe(HttpStatus.NOT_MODIFIED);
    });

    it('compresses an asset for a client that reads brotli', async () => {
        const res: Response = await fetch(`${baseUrl}/assets/styles/style.css`, { headers: { 'accept-encoding': 'br' } });

        expect(res.status).toBe(HttpStatus.OK);
        expect(res.headers.get(KnownHeader.CONTENT_ENCODING)).toBe('br');
        // decoded by fetch on the way in, so this is the file rather than its encoding
        await expect(res.text()).resolves.toContain('body { color: black; }');
    });
});