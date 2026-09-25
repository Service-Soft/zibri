import { IncomingMessage, Server, request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import express, { Express } from 'express';

import { compressionMiddleware } from './compression.middleware';
import { MimeType } from './mime-type.enum';
import { initDiContainer } from '../di/init-di-container.function';
import { FsUtilities, FsPath } from '../utilities/fs.utilities';

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

        folder = FsUtilities.getPath(tmpdir(), `zibri-compression-${process.pid}`);
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