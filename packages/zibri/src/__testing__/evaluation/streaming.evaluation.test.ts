import { Readable } from 'stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { LogLevel } from '../../logging/log-level.enum.ts';
import { Log } from '../../logging/log.model.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { Response } from '../../open-api/decorators/response.decorator.ts';
import { FileResponse } from '../../parsing/form-data/file-response.model.ts';
import { HtmlResponse } from '../../parsing/html/html-response.model.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Get } from '../../routing/decorators/get.decorator.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

/**
 * Executable form of evaluation/02-http-runtime-core.md M1 - a stream error after the headers were
 * sent throws inside an 'error' listener.
 *
 * The listener calls res.removeHeader, which throws ERR_HTTP_HEADERS_SENT once the head is
 * flushed. Because it throws from inside an event listener it misses the try/catch around the
 * controller call entirely and becomes an uncaught exception - and the framework's uncaught
 * exception handler logs and then rethrows, which ends the process.
 *
 * Every expectation describes the fixed behavior, so the reds here are the open finding.
 * See ./README.md for why.
 */

/**
 * A stream that hands over one chunk and then fails, the way a disk or an object store does.
 *
 * The first chunk is what makes this the case the finding is about: piping it writes the head, so
 * by the time the error arrives the headers can no longer be removed. A stream that failed before
 * producing anything would take the ordinary error path and prove nothing.
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

/**
 * A stream that produces one chunk and ends cleanly.
 * @returns The stream.
 */
function healthyStream(): Readable {
    return Readable.from([Buffer.alloc(64 * 1024, 'a')]);
}

@Controller('/evaluation-streaming')
class EvaluationStreamingController {
    @Response.file()
    @Get('/failing-file')
    failingFile(): FileResponse {
        return FileResponse.fromStream({
            stream: streamThatFailsAfterItsFirstChunk(),
            filename: 'report.csv',
            mimeType: 'text/csv'
        });
    }

    @Response.file()
    @Get('/healthy-file')
    healthyFile(): FileResponse {
        return FileResponse.fromStream({
            stream: healthyStream(),
            filename: 'report.csv',
            mimeType: 'text/csv'
        });
    }

    @Response.html()
    @Get('/failing-page')
    failingPage(): HtmlResponse {
        return HtmlResponse.fromStream(streamThatFailsAfterItsFirstChunk());
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * How the uncaught exception half of this finding is observed.
 *
 * By the guard in vitest.setup.ts, which fails the test an uncaught exception was thrown in with
 * that error and its line. It catches the throw before any listener does, so the framework's own
 * handler (which logs and deliberately rethrows) does not run here, and nothing ends the worker
 * along with the tests after this one.
 *
 * What each test below states explicitly is the other half - that the response ends.
 */

/**
 * How a download ended.
 *
 * A truncated body is a fine outcome once the head is out - nothing can turn a failed stream back
 * into a complete file. Waiting forever is not, so the two are told apart rather than both being
 * treated as "it failed".
 */
type DownloadOutcome = 'completed' | 'ended by the server' | 'never ended';

/**
 * The client's own patience, which only ever runs out when the server left the response open.
 */
const CLIENT_TIMEOUT_MS: number = 1000;

/**
 * Asks for a route and reads it to the end, giving up rather than waiting forever.
 *
 * The abort is what keeps this test reporting a failed assertion instead of a timed out test: a
 * response the server never ends would otherwise hold the request until the test times out, which says
 * nothing about why.
 * @param path - The route to request.
 * @returns How the download ended.
 */
async function download(path: string): Promise<DownloadOutcome> {
    try {
        const res: globalThis.Response = await fetch(
            `${baseUrl}/evaluation-streaming${path}`,
            {
                signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
                // asking for no encoding is what keeps this file about the case it describes. An
                // encoder holds the first bytes back until it has enough of them to be worth
                // writing, so a stream failing after one chunk would fail with its head still
                // unsent - which is the other branch, and the one that was never broken.
                headers: { 'accept-encoding': 'identity' }
            }
        );
        await res.text();
        return 'completed';
    }
    catch (error) {
        return error instanceof Error && error.name === 'TimeoutError' ? 'never ended' : 'ended by the server';
    }
}

beforeAll(async () => {
    server = await startTestServer({ controllers: [EvaluationStreamingController] });
    baseUrl = await server.start();
}, 30000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 15000);

describe('evaluation/02-http-runtime-core M1 - a stream that fails mid download', () => {

    it('serves a file stream that does not fail', async () => {
        // a control: it establishes that the streaming route works, so the reds below are about the
        // failure rather than about file responses being broken here
        const res: globalThis.Response = await fetch(`${baseUrl}/evaluation-streaming/healthy-file`);

        expect(res.status).toBe(200);
        expect((await res.text()).length).toBe(64 * 1024);
    });

    it('survives a file stream that fails after the head was sent, and ends the response', async () => {
        const outcome: DownloadOutcome = await download('/failing-file');

        // Today this fails on more than the assertion. removeHeader after the head is flushed throws
        // ERR_HTTP_HEADERS_SENT from inside the very listener that exists to handle the failure,
        // and the guard fails the test with that error and that line - see the note above.
        // Streaming a large download is not an exotic case, it is the only case: any file past one
        // chunk has its head out already.
        //
        // The assertion is the second half. The throw lands on the *first* removeHeader, so
        // next(err) is never reached and nothing ever ends the response - the client holds an open
        // connection until its own patience runs out, one leaked socket per failed download. A
        // truncated body is fine and expected; waiting forever is not.
        expect(outcome).not.toBe('never ended');
    });

    it('survives an html stream that fails after the head was sent, and ends the response', async () => {
        // the same listener written a second time for html responses, so a fix applied to one of
        // them leaves this one red
        const outcome: DownloadOutcome = await download('/failing-page');

        expect(outcome).not.toBe('never ended');
    });

    it('records the failure it can no longer answer', async () => {
        await download('/failing-file');

        // once the status is on the wire nothing can turn this into an error page, so the log is the
        // only record that a download failed at all. Without it a client reporting a truncated file
        // is a report with nothing on the server side to match it to.
        await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
        const logs: Log[] = await inject(repositoryTokenFor(Log)).findAll({ where: { level: LogLevel.ERROR } });

        // and it has to name what actually failed, not only that something did - the cause is the
        // difference between "a download broke" and "the disk went away"
        expect(logs.some(l => l.message.includes('after its headers were sent'))).toBe(true);
        expect(
            logs.some(l => l.context.error?.paragraphs.some(p => p.includes('the disk went away mid stream')) === true)
        ).toBe(true);
    });
});