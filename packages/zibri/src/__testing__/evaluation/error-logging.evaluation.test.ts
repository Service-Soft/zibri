import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { Where } from '../../data-source/models/where/where-filter.model.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { LogLevel } from '../../logging/log-level.enum.ts';
import { Log } from '../../logging/log.model.ts';
import { LoggerInterface } from '../../logging/logger.interface.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Get } from '../../routing/decorators/get.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { createTestDataSource } from '../test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

/**
 * Executable form of evaluation/02-http-runtime-core.md section M6.
 *
 * Nothing is substituted here. The default logger transports include LoggerTransport.db, and Log
 * is already one of the test data source's entities, so the framework writes real rows through the
 * real transport. The test throws from a real endpoint and then reads back what was persisted.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ./README.md for why.
 */

const thrownMessage: string = 'evaluation-distinctive-failure';

@Controller('/evaluation-error-logging')
class EvaluationErrorController {
    @Get('/boom')
    boom(): string {
        throw new Error(thrownMessage);
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;
let logRepository: Repository<Log>;

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource();

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [dataSourceClass],
        controllers: [EvaluationErrorController],
        // opt in, because it is opt in: a line per request through the default database transport is
        // a cost an application has to choose. The cases below are what it buys
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.ACCESS_LOG, useValue: true })
        ],
        // the client ip case below is about the option working, not about its default. Trusting a
        // forwarded header from anyone is the wrong default and the framework does not, so a test
        // that did not set this would be asserting that the safe default is a bug
        security: { trustProxy: 1 }
    });
    baseUrl = await server.start();
    logRepository = inject(repositoryTokenFor(Log));
}, 60000);

/**
 * Reads back what was actually persisted.
 *
 * The flush is not optional. Logging hands the entry to a queue and returns, so a query issued
 * straight after the request that caused it sees an empty table and the test fails for a reason that
 * has nothing to do with the finding - which is exactly what happened to three of the cases below.
 * @param where - The filter to read with.
 * @returns Every log row matching the filter, once the queue has drained.
 */
async function persistedLogs(where?: Where<Log>): Promise<Log[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return await logRepository.findAll(where ? { where } : {});
}

/**
 * Empties the table *and* the queue behind it.
 *
 * Deleting the rows alone is not a clean slate: the previous test's entries may still be queued, and
 * they would drain into the table this one is about to read. Flushing first is what makes them rows
 * that the delete then removes.
 */
async function clearLogs(): Promise<void> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    await logRepository.deleteAll({});
}

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 30000);

describe('evaluation/02-http-runtime-core M6 - a 5xx must be diagnosable from the logs', () => {

    it('records the error that actually happened', async () => {
        await clearLogs();

        const res: Response = await fetch(`${baseUrl}/evaluation-error-logging/boom`);
        expect(res.status).toBe(500);

        const logs: Log[] = await persistedLogs({ level: LogLevel.ERROR });

        // guard: if nothing was persisted at all, the assertions below would pass vacuously
        expect(logs.length).toBeGreaterThan(0);

        // the message an aggregator groups on. The handler used to log a GlobalError instead, whose
        // message is the literal string 'Global Error', so every 5xx in the whole application arrived
        // under one identical message and none of them could be grouped or alerted on
        expect(logs.some(l => l.message.includes(thrownMessage))).toBe(true);
    }, 60000);

    it('keeps the stack trace of the error', async () => {
        await clearLogs();

        await fetch(`${baseUrl}/evaluation-error-logging/boom`);

        const logs: Log[] = await persistedLogs({ level: LogLevel.ERROR });
        expect(logs.length).toBeGreaterThan(0);

        // Asserted on the stackTrace field itself, and that detail is the point. An earlier version
        // of this test searched the serialized context for the throw site and passed, because the
        // wrapper kept the original error as its cause and other parts of the context mention the
        // route - while the field an aggregator actually reads was empty the whole time, since the
        // handler blanked the wrapper's stack before logging it.
        const stackTraces: string[][] = logs.map(l => l.context.error?.stackTrace ?? []);
        expect(stackTraces.some(s => s.length > 0)).toBe(true);
    }, 60000);

    it('records the real client ip rather than the proxy address', async () => {
        await clearLogs();

        await fetch(`${baseUrl}/evaluation-error-logging/boom`, {
            headers: { 'x-forwarded-for': '203.0.113.7' }
        });

        const logs: Log[] = await persistedLogs({ level: LogLevel.ERROR });
        expect(logs.length).toBeGreaterThan(0);

        // express `trust proxy` is never enabled anywhere, so req.ip is the socket address of the
        // load balancer for every request behind an ingress: every log line in production carries
        // the same clientIp, and nothing can be traced back to a caller. The same gap makes the
        // HSTS decision read X-Forwarded-Proto straight from the client.
        expect(logs.some(l => l.context.request?.clientIp === '203.0.113.7')).toBe(true);
    }, 60000);

    it('records a client error too, so a 4xx storm is visible', async () => {
        await clearLogs();

        // a path with no route raises a real NotFoundError through the real pipeline. A malformed
        // cookie would be the wrong trigger here: that produces a URIError, which is not an
        // ExternalError and therefore already gets logged - the test would pass without the
        // finding being fixed.
        const res: Response = await fetch(`${baseUrl}/definitely-not-a-route`);
        expect(res.status).toBe(404);

        const logs: Log[] = await persistedLogs();

        // an access log line rather than an error or a warning. Raising a missing icon to a warning
        // would say "this might be a concern" about something that routinely is not, and the client
        // errors that *are* security events reach the record through the audit trail instead
        const accessLines: Log[] = logs.filter(l => l.context.request?.status === 404);
        expect(accessLines.length).toBeGreaterThan(0);
        expect(accessLines.every(l => l.level === LogLevel.INFO)).toBe(true);
    }, 60000);

    it('records how long a request took', async () => {
        await clearLogs();

        await fetch(`${baseUrl}/definitely-not-a-route`);

        const logs: Log[] = await persistedLogs();

        // the `// TODO: track duration on requests` this replaces. A duration is only knowable once
        // the response has closed, which is why no other log line can carry one and why this is the
        // writer that does
        const durations: number[] = logs
            .map(l => l.context.request?.durationInMs)
            .filter(d => d != undefined);
        expect(durations.length).toBeGreaterThan(0);
        expect(durations.every(d => d >= 0)).toBe(true);
    }, 60000);

    it('records a request that no route matched, which never had a context to read', async () => {
        await clearLogs();

        await fetch(`${baseUrl}/definitely-not-a-route`);

        const logs: Log[] = await persistedLogs();

        // the reason the access log builds its own context instead of reading async local storage:
        // a request that matched no route never had one, so anything that derived the url from the
        // request context would have nothing to say about exactly the requests worth seeing
        expect(logs.some(l => l.context.request?.url === '/definitely-not-a-route')).toBe(true);
    }, 60000);
});

describe('evaluation/02-http-runtime-core M7 - a log line has to name the request that caused it', () => {
    // 32 hex characters, because a traceparent that does not parse is treated as though none
    // arrived - which would make these pass for the wrong reason
    const callerTraceId: string = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const oneRequestTraceId: string = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';

    it('records the trace the caller sent', async () => {
        await clearLogs();

        await fetch(`${baseUrl}/definitely-not-a-route`, {
            headers: { traceparent: `00-${callerTraceId}-0000000000000001-01` }
        });

        const logs: Log[] = await persistedLogs();

        // the finding: the token was defined in two places and read by nothing, so an id a caller
        // quoted matched no line in the log and the one thing that could join a report to the work
        // it describes was the timestamp
        expect(logs.some(l => l.context.request?.traceId === callerTraceId)).toBe(true);
    }, 60000);

    it('gives a request that brought none a trace of its own', async () => {
        await clearLogs();

        await fetch(`${baseUrl}/definitely-not-a-route`);

        const logs: Log[] = await persistedLogs();
        const ids: (string | undefined | null)[] = logs
            .filter(l => l.context.request?.url === '/definitely-not-a-route')
            .map(l => l.context.request?.traceId);

        // a trace only an upstream service can supply is missing exactly where a request arrived
        // from outside, which is most of them
        expect(ids.length).toBeGreaterThan(0);
        expect(ids.every(id => id != undefined && id !== '')).toBe(true);
    }, 60000);

    it('gives every line of one request the same trace', async () => {
        await clearLogs();

        // a 5xx, so the error line and the access log line are both written for one request
        const res: Response = await fetch(`${baseUrl}/evaluation-error-logging/boom`, {
            headers: { traceparent: `00-${oneRequestTraceId}-0000000000000001-01` }
        });
        expect(res.status).toBe(500);

        const logs: Log[] = await persistedLogs();
        const lines: Log[] = logs.filter(l => l.context.request?.traceId === oneRequestTraceId);

        // the point of an id rather than a timestamp: the error and the line saying the request
        // happened are one story, and joining them must not depend on reading two clocks
        expect(lines.some(l => l.level === LogLevel.ERROR)).toBe(true);
        expect(lines.some(l => l.context.request?.durationInMs != undefined)).toBe(true);
    }, 60000);
});