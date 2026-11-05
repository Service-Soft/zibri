import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { HttpResponse } from '../http/http-response.model';
import { HttpStatus } from '../http/http-status.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { LogLevel } from '../logging/log-level.enum';
import { Log } from '../logging/log.model';
import { LoggerInterface } from '../logging/logger.interface';
import { Response } from '../open-api/decorators/response.decorator';
import { FileResponse } from '../parsing/form-data/file-response.model';
import { HtmlResponse } from '../parsing/html/html-response.model';

/**
 * Server-sent events written the way creating-endpoints.md shows it: from the handler, onto the
 * response of the request, with the handler returning once the headers are out.
 */
@Controller('/progress')
class ProgressController {
    @Get('/', { timeoutInMs: 50 })
    stream(): void {
        const ctx: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (ctx?.type !== 'http-request') {
            return;
        }
        const res: HttpResponse = ctx.response;
        res.writeHead(HttpStatus.OK, { [KnownHeader.CONTENT_TYPE]: MimeType.EVENT_STREAM });
        let step: number = 0;
        const timer: NodeJS.Timeout = setInterval(() => {
            step++;
            res.write(`data: ${step}\n\n`);
            if (step === 3) {
                clearInterval(timer);
                res.end();
            }
        }, 30);
        res.on('close', () => clearInterval(timer));
    }
}

/**
 * A stream that hands over one chunk and then fails, the way a disk or an object store does. The first
 * chunk is what writes the head, so by the time the error arrives the headers are out; a stream failing
 * before producing anything takes the ordinary error path.
 * @returns The stream.
 */
function streamThatFailsAfterItsFirstChunk(): Readable {
    let sentFirstChunk: boolean = false;
    return new Readable({
        read(): void {
            if (!sentFirstChunk) {
                sentFirstChunk = true;
                this.push(Buffer.alloc(64 * 1024, 'a'));
                return;
            }
            this.destroy(new Error('the disk went away mid stream'));
        }
    });
}

@Controller('/downloads')
class DownloadController {
    @Response.file()
    @Get('/failing-file')
    failingFile(): FileResponse {
        return FileResponse.fromStream({ stream: streamThatFailsAfterItsFirstChunk(), filename: 'report.csv', mimeType: 'text/csv' });
    }

    @Response.file()
    @Get('/healthy-file')
    healthyFile(): FileResponse {
        return FileResponse.fromStream({ stream: Readable.from([Buffer.alloc(64 * 1024, 'a')]), filename: 'report.csv', mimeType: 'text/csv' });
    }

    @Response.html()
    @Get('/failing-page')
    failingPage(): HtmlResponse {
        return HtmlResponse.fromStream(streamThatFailsAfterItsFirstChunk());
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;

beforeAll(async () => {
    server = await startTestServer({
        controllers: [ProgressController, DownloadController],
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// how a handler sends server-sent events is what creating-endpoints.md shows, so it is checked here
describe('a response a handler streams itself', () => {
    it('reaches the client whole, past the handler\'s deadline', async () => {
        const res: Response = await fetch(`${baseUrl}/progress`);

        expect(res.status).toBe(HttpStatus.OK);
        expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toBe(MimeType.EVENT_STREAM);
        await expect(res.text()).resolves.toBe('data: 1\n\ndata: 2\n\ndata: 3\n\n');
    });
});

/**
 * How a download ended. A truncated body is a fine outcome once the head is out, since nothing can turn
 * a failed stream back into a whole file. Waiting forever is not.
 */
type DownloadOutcome = 'completed' | 'ended by the server' | 'never ended';

/**
 * Asks for a route and reads it to the end, giving up rather than waiting forever, so a response the
 * server never ends fails an assertion instead of timing the case out.
 * @param path - The route below the downloads controller.
 * @returns How the download ended.
 */
async function download(path: string): Promise<DownloadOutcome> {
    try {
        const res: globalThis.Response = await fetch(`${baseUrl}/downloads${path}`, {
            signal: AbortSignal.timeout(1000),
            // an encoder holds the first bytes back until it has enough of them, so a stream failing
            // after one chunk would fail with its head still unsent - the other branch
            headers: { 'accept-encoding': 'identity' }
        });
        await res.text();
        return 'completed';
    }
    catch (error) {
        return error instanceof Error && error.name === 'TimeoutError' ? 'never ended' : 'ended by the server';
    }
}

// a stream failing once its head is out can no longer be answered with an error. Handled where the head
// is removed, that removal threw from inside the error listener, past every try around the handler, and
// left the response open: one leaked socket per failed download
describe('a stream that fails mid download', () => {
    it('serves a file stream that does not fail', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/downloads/healthy-file`);

        expect(res.status).toBe(200);
        expect((await res.text()).length).toBe(64 * 1024);
    });

    // an uncaught throw from the listener fails the case under jest by itself, so the assertion is
    // the other half: that the response ends
    it('survives a file stream that fails after the head was sent, and ends the response', async () => {
        expect(await download('/failing-file')).not.toBe('never ended');
    });

    it('survives an html stream that fails after the head was sent, and ends the response', async () => {
        expect(await download('/failing-page')).not.toBe('never ended');
    });

    // once the status is on the wire the log is the only record a download failed, and it names the
    // cause: "the disk went away" rather than "a download broke"
    it('records the failure it can no longer answer, with its cause', async () => {
        await download('/failing-file');

        await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
        const logs: Log[] = await inject(repositoryTokenFor(Log)).findAll({ where: { level: LogLevel.ERROR } });

        expect(logs.some(l => l.message.includes('after its headers were sent'))).toBe(true);
        expect(logs.some(l => l.context.error?.paragraphs.some(p => p.includes('the disk went away mid stream')) === true)).toBe(true);
    });
});