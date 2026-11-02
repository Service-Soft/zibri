import { IncomingMessage, Server, request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import express, { Express } from 'express';
import { createInMemoryDataSource } from 'zibri-testing';

import { compressionMiddleware } from './compression.middleware';
import { HttpMethod } from './http-method.enum';
import { KnownHeader } from './known-header.enum';
import { MimeType } from './mime-type.enum';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { initDiContainer } from '../di/init-di-container.function';
import { inject } from '../di/inject.function';
import { type RouterInterface } from '../routing/router.interface';
import { FsUtilities, FsPath } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

type RawResponse = { status: number, contentEncoding: string | undefined, body: Buffer };

/**
 * Requests a route with node's own client, which hands back what arrived rather than a decoded body.
 *
 * `fetch` decodes an encoded response on its own, and what these tests are about is whether every
 * byte of it arrives at all.
 * @param url - What to request.
 * @param acceptEncoding - What the client says it can read.
 * @returns The status, the encoding the response carries and its raw bytes.
 */
async function requestRaw(url: string, acceptEncoding: string): Promise<RawResponse> {
    return await new Promise<RawResponse>((resolve, reject) => {
        const req: ReturnType<typeof httpRequest> = httpRequest(
            url,
            { headers: { 'accept-encoding': acceptEncoding } },
            (res: IncomingMessage) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => resolve({
                    status: res.statusCode ?? 0,
                    contentEncoding: res.headers['content-encoding'],
                    body: Buffer.concat(chunks)
                }));
                res.on('error', reject);
            }
        );
        req.on('error', reject);
        req.end();
    });
}

describe('compressionMiddleware', () => {
    // large enough to need more chunks than the encoder holds at once and to fill the socket on the
    // way out, which are the two places a write is refused. Repetitive so the encoded body is small -
    // what is being measured is the handover between the two, not zlib.
    const bodyChunks: string[] = Array.from({ length: 800 }, () => 'the quick brown fox jumps over the lazy dog\n'.repeat(100));
    const largeBody: string = bodyChunks.join('');
    let folder: FsPath;
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
        initDiContainer();

        folder = FsUtilities.getPath(testFileFolder, `compression-${UUIDUtilities.generate()}`);
        await FsUtilities.createFile(FsUtilities.getPath(folder, 'large.txt'), largeBody);

        const app: Express = express();
        app.use(compressionMiddleware());
        // the two ways the framework answers with a body it does not hold in one piece: a file on
        // disk, which is what `res.sendFile` does for a FileResponse built from a path, and a stream
        // piped into the response, which is what the router does for every other FileResponse
        app.get('/file', (_, res) => res.sendFile(FsUtilities.getPath(folder, 'large.txt')));
        app.get('/stream', (_, res) => {
            res.setHeader('content-type', MimeType.TXT);
            Readable.from(bodyChunks).pipe(res);
        });

        server = app.listen(0);
        await new Promise<void>(resolve => server.once('listening', () => resolve()));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        await FsUtilities.rm(folder);
    });

    it('sends a file larger than the encoder holds at once in full', async () => {
        const res: RawResponse = await requestRaw(`${baseUrl}/file`, 'gzip');

        expect(res.status).toBe(200);
        expect(res.contentEncoding).toBe('gzip');
        expect(gunzipSync(res.body).toString()).toBe(largeBody);
    }, 10000);

    it('sends a stream larger than the encoder holds at once in full', async () => {
        const res: RawResponse = await requestRaw(`${baseUrl}/stream`, 'gzip');

        expect(res.status).toBe(200);
        expect(res.contentEncoding).toBe('gzip');
        expect(gunzipSync(res.body).toString()).toBe(largeBody);
    }, 10000);

    it('sends a file to a browser, which reads brotli, in full', async () => {
        const res: RawResponse = await requestRaw(`${baseUrl}/file`, 'gzip, deflate, br, zstd');

        expect(res.status).toBe(200);
        expect(res.contentEncoding).toBe('br');
        expect(brotliDecompressSync(res.body).toString()).toBe(largeBody);
    }, 10000);

    it('sends a file a client reads no encoding for in full', async () => {
        const res: RawResponse = await requestRaw(`${baseUrl}/file`, 'identity');

        expect(res.status).toBe(200);
        expect(res.contentEncoding).toBeUndefined();
        expect(res.body.toString()).toBe(largeBody);
    }, 10000);
});

// the cases above are the middleware on its own; these are the application installing it in front of
// what its routes answer
describe('compression of a routed answer', () => {
    let server: StartedTestServer | undefined;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
        });
        baseUrl = await server.start();
        const router: RouterInterface = inject(ZIBRI_DI_TOKENS.ROUTER);
        router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/compressed/large',
            openApi: { useInOpenApi: false },
            handler: () => ({ rows: Array.from({ length: 2000 }, (_, i) => ({ id: `row-${i}`, name: `a name worth writing out ${i}` })) })
        });
        router.registerRoute({ httpMethod: HttpMethod.GET, route: '/compressed/small', openApi: { useInOpenApi: false }, handler: () => ({ ok: true }) });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    /**
     * Requests a route, reading what it answered.
     * @param path - The route.
     * @param acceptEncoding - What the client says it can read.
     * @returns The answer, its body read.
     */
    async function fetchWith(path: string, acceptEncoding: string): Promise<globalThis.Response> {
        const res: globalThis.Response = await fetch(`${baseUrl}${path}`, { headers: { [KnownHeader.ACCEPT_ENCODING]: acceptEncoding } });
        await res.arrayBuffer();
        return res;
    }

    it('compresses an answer for a client that asks for it, and says so to any cache', async () => {
        const res: globalThis.Response = await fetchWith('/compressed/large', 'gzip');

        expect(res.headers.get(KnownHeader.CONTENT_ENCODING)).toBe('gzip');
        // a cache that kept this must not hand it to a client reading no gzip, and this is the only
        // thing telling it the two are different answers
        expect(res.headers.get(KnownHeader.VARY)?.toLowerCase()).toContain('accept-encoding');
        // the length the client would have been told is the plain body's, which it is not getting
        expect(res.headers.get(KnownHeader.CONTENT_LENGTH)).toBeNull();
    });

    it('prefers brotli over gzip for a client that reads both', async () => {
        expect((await fetchWith('/compressed/large', 'gzip, br')).headers.get(KnownHeader.CONTENT_ENCODING)).toBe('br');
    });

    // the control keeping the two above about compression rather than about headers set on everything
    it('leaves an answer alone for a client that asked for no encoding', async () => {
        expect((await fetchWith('/compressed/large', 'identity')).headers.get(KnownHeader.CONTENT_ENCODING)).toBeNull();
    });

    // a few dozen bytes, where the encoding header is most of what the client would receive and the
    // encoded body usually the larger of the two
    it('leaves an answer too small to be worth encoding alone', async () => {
        expect((await fetchWith('/compressed/small', 'gzip, br')).headers.get(KnownHeader.CONTENT_ENCODING)).toBeNull();
    });
});