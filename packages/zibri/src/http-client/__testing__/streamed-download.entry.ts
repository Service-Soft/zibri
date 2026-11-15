// The process http-client.streamed-download.test.ts downloads in: a process of its own, since what it
// checks for is a crash that no handler can catch, which would end the jest worker with it. It
// downloads from a server that closes the connection after each response, reads the body slower
// than it arrives, and sends its parent how many bytes it got of each download.
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { createInMemoryDataSource } from 'zibri-testing';

import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { MimeType } from '../../http/mime-type.enum';
import { HttpClientInterface } from '../http-client.interface';
import { STREAMED_DOWNLOAD_BYTES, STREAMED_DOWNLOADS } from './streamed-download.constants';

const CHUNK: Buffer = Buffer.alloc(1024 * 1024, 7);

/**
 * Answers every request with {@link STREAMED_DOWNLOAD_BYTES}, and closes the connection after it,
 * as some S3 compatible services do.
 * @param req - The request.
 * @param res - The response.
 */
function serve(req: IncomingMessage, res: ServerResponse): void {
    // with its length, or ended by closing the connection alone, as an answer without one is
    res.writeHead(200, {
        'content-type': MimeType.OCTET_STREAM,
        ...req.url === '/with-length' ? { 'content-length': STREAMED_DOWNLOAD_BYTES } : {},
        connection: 'close'
    });
    let sent: number = 0;
    const write: () => void = () => {
        while (sent < STREAMED_DOWNLOAD_BYTES) {
            sent += CHUNK.length;
            if (!res.write(CHUNK)) {
                res.once('drain', write);
                return;
            }
        }
        res.end();
    };
    write();
}

/**
 * Downloads once, reading slower than the data arrives, as a restore writing to disk does.
 * @param client - The client.
 * @param url - Where from.
 * @returns How many bytes arrived.
 */
async function download(client: HttpClientInterface, url: string): Promise<number> {
    const body: Readable = (await client.get(url, {
        responseBody: { type: MimeType.OCTET_STREAM, maxSize: `${STREAMED_DOWNLOAD_BYTES}b` }
    })).body;
    let received: number = 0;
    await pipeline(body, new Writable({
        highWaterMark: 1024,
        // eslint-disable-next-line promise/prefer-await-to-callbacks
        write: (chunk: Buffer, _encoding, callback) => {
            received += chunk.length;
            // slower than the data arrives for the whole of it, so that the body is paused whenever
            // the last of it and the end of the connection arrive
            setTimeout(callback, 1);
        }
    }));
    return received;
}

/**
 * Downloads, and reports to the parent.
 */
async function main(): Promise<void> {
    // a whole application, which registers the parsers of the bodies the client reads
    const app: StartedTestServer = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
    });
    const client: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);

    const server: Server = createServer(serve);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url: string = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const received: number[] = [];
    try {
        for (let i: number = 0; i < STREAMED_DOWNLOADS; i++) {
            received.push(await download(client, `${url}/${i % 2 === 0 ? 'with-length' : 'until-closed'}`));
        }
    }
    finally {
        server.close();
        await app.shutdown();
    }
    process.send?.({ received });
}

void main();