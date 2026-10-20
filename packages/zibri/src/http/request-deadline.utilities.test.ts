import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { Express } from 'express';
import { createInMemoryDataSource } from 'zibri-testing';

import { HttpMethod } from './http-method.enum.ts';
import { HttpServerLimits } from './http-server-limits.model.ts';
import { HttpStatus } from './http-status.enum.ts';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity.ts';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { AlsUtilities } from '../context/als.utilities.ts';
import { HttpRequestContext } from '../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../context/request/websocket-request.context.ts';
import { Repository } from '../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { defineProvider, DiProvider } from '../di/models/di-provider.model.ts';
import { HttpClientInterface } from '../http-client/http-client.interface.ts';
import { LeaseServiceInterface } from '../leases/lease-service.interface.ts';
import { Response } from '../open-api/decorators/response.decorator.ts';
import { FileResponse } from '../parsing/form-data/file-response.model.ts';
import { Controller } from '../routing/decorators/controller.decorator.ts';
import { Get } from '../routing/decorators/get.decorator.ts';
import { RouterInterface } from '../routing/router.interface.ts';

/**
 * What a refused or failed request answers with.
 */
type ErrorResponseBody = {
    /**
     * The http status of the response.
     */
    status: number,
    /**
     * The name of the error class that produced it.
     */
    name: string,
    /**
     * The trace this request belongs to.
     */
    traceId: string | undefined
};

/**
 * What a handler reports about the request it ran in, once it is over.
 */
type HandlerRecord = {
    /**
     * Whether the signal on the request context had fired by the time the handler finished.
     */
    signalAborted: boolean,
    /**
     * Whether the handler ran to the end at all.
     */
    finished: boolean
};

/**
 * What the handlers below record, keyed by the route that wrote it.
 *
 * A handler the framework has stopped waiting for still runs, so what it did is not something its
 * response can carry - the response was sent without it. Writing it here is what lets a second
 * request ask what became of the first.
 */
const records: Map<string, HandlerRecord> = new Map();

/**
 * Waits, without holding the event loop open past the suite.
 * @param ms - How long to wait.
 */
async function wait(ms: number): Promise<void> {
    await new Promise<void>(resolve => {
        setTimeout(resolve, ms).unref();
    });
}

/**
 * The deadline the request this runs in was given.
 *
 * Read off the context rather than passed in, which is the whole point of putting it there: a
 * service several calls below the handler can ask without anything having threaded it down.
 * @returns The signal of the running request.
 * @throws When there is no request running, which is a broken test rather than a failing one.
 */
function currentSignal(): AbortSignal {
    const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
    if (!context) {
        throw new Error('no request context');
    }
    return context.signal;
}

// 50ms, so that a route which deliberately overruns costs the suite a tenth of a second rather than
// a wall clock second per case. Every handler below is either far inside it or far outside it - a
// case that turned on a few milliseconds either way would fail on a loaded machine
@Controller('/deadline', { timeoutInMs: 50 })
class DeadlineController {
    @Get('/inherits')
    async inherits(): Promise<{ ok: boolean }> {
        await wait(400);
        records.set('inherits', { signalAborted: currentSignal().aborted, finished: true });
        return { ok: true };
    }

    @Get('/fast')
    async fast(): Promise<{ ok: boolean }> {
        await wait(5);
        records.set('fast', { signalAborted: currentSignal().aborted, finished: true });
        return { ok: true };
    }

    @Get('/own', { timeoutInMs: 1000 })
    async own(): Promise<{ ok: boolean }> {
        // longer than the controller's 50ms and well inside its own second
        await wait(200);
        return { ok: true };
    }

    @Get('/none', { timeoutInMs: 'none' })
    async none(): Promise<{ ok: boolean }> {
        await wait(200);
        return { ok: true };
    }

    @Get('/throws-late')
    async throwsLate(): Promise<{ ok: boolean }> {
        await wait(150);
        records.set('throws-late', { signalAborted: currentSignal().aborted, finished: true });
        throw new Error('failed long after the caller was answered');
    }

    @Response.file()
    @Get('/slow-stream')
    slowStream(): FileResponse {
        // the handler itself returns at once. What takes longer than the deadline is writing the
        // body, which is the case the coverage decision turns on
        const stream: Readable = Readable.from((async function* () {
            for (let i: number = 0; i < 5; i++) {
                await wait(30);
                yield `chunk-${i}\n`;
            }
        })());
        return FileResponse.fromStream({ stream, filename: 'slow.txt', mimeType: 'text/plain' });
    }
}

// no deadline of its own, so its routes fall back to whatever the application says
@Controller('/app-default')
class AppDefaultController {
    @Get('/slow')
    async slow(): Promise<{ ok: boolean }> {
        await wait(400);
        return { ok: true };
    }
}

/**
 * What the upstream saw of a request the http client sent it.
 */
type UpstreamRecord = {
    /**
     * Whether the caller was still there when the upstream got round to answering.
     */
    clientStillConnected: boolean
};

let upstreamUrl: string = '';
let upstreamServer: Server | undefined;
const upstreamRecords: UpstreamRecord[] = [];

// an upstream that answers slower than the route calling it is allowed to take, which is the whole
// case: the handler is waiting on something outside itself when its time runs out
@Controller('/upstream')
class UpstreamController {
    @Get('/slow', { timeoutInMs: 80 })
    async callSlow(): Promise<{ ok: boolean }> {
        const client: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
        try {
            // no timeout of its own and no signal passed: the deadline of the request this runs in
            // is what has to end it
            await client.get(`${upstreamUrl}/slow`, { timeoutMs: 10_000 });
            records.set('upstream', { signalAborted: currentSignal().aborted, finished: true });
            return { ok: true };
        }
        catch (error) {
            records.set('upstream-failed', { signalAborted: currentSignal().aborted, finished: true });
            throw error;
        }
    }
}

let waitedForLeaseMs: number | undefined;
let queriesAfterDeadline: number | undefined;

// a handler that keeps reading the store after it has been answered for
@Controller('/store')
class StoreController {
    @Get('/keeps-reading', { timeoutInMs: 80 })
    async keepsReading(): Promise<{ ok: boolean }> {
        const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
        // counted rather than timed: what matters is how many reads the store answered once the
        // signal had already fired, and a machine under load would move any wall clock boundary
        let afterDeadline: number = 0;
        try {
            for (let i: number = 0; i < 8; i++) {
                await wait(40);
                await users.findAll();
                if (currentSignal().aborted) {
                    afterDeadline++;
                }
            }
            return { ok: true };
        }
        finally {
            // every one of these is a connection held and a query planned for a caller that has
            // already been answered
            queriesAfterDeadline = afterDeadline;
        }
    }
}

// a lease somebody else holds for longer than the route is allowed to wait for it
@Controller('/lease')
class LeaseController {
    @Get('/contended', { timeoutInMs: 80 })
    async contended(): Promise<{ ok: boolean }> {
        const leases: LeaseServiceInterface = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
        const startedAt: number = Date.now();
        try {
            await leases.withLease(
                { key: 'deadline-contended', leaseInMs: 60_000, mode: 'wait', acquireTimeoutInMs: 10_000 },
                async () => await wait(10)
            );
            records.set('lease', { signalAborted: currentSignal().aborted, finished: true });
            return { ok: true };
        }
        catch (error) {
            waitedForLeaseMs = Date.now() - startedAt;
            records.set('lease-failed', { signalAborted: currentSignal().aborted, finished: true });
            throw error;
        }
    }
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

const limits: HttpServerLimits = {
    requestInMs: 60000,
    headersInMs: 15000,
    keepAliveInMs: 5000,
    handlerInMs: 80,
    maxHeaderCount: 100,
    maxHeaderSizeInBytes: 16 * 1024
};

const providers: DiProvider<unknown>[] = [
    ...defaultTestServerProviders,
    defineProvider({ token: ZIBRI_DI_TOKENS.HTTP_SERVER_LIMITS, useValue: limits })
];

let server: StartedTestServer | undefined;
let baseUrl: string;

beforeAll(async () => {
    const upstream: Express = express();
    upstream.get('/slow', (req, res) => {
        // long past the 80ms the route calling this is allowed, so what decides the outcome is
        // whether the caller gave up rather than how fast this is
        const timer: NodeJS.Timeout = setTimeout(() => {
            upstreamRecords.push({ clientStillConnected: !req.destroyed });
            res.json({ ok: true });
        }, 600);
        req.on('close', () => clearTimeout(timer));
    });
    upstreamServer = upstream.listen(0);
    await new Promise<void>(resolve => upstreamServer?.once('listening', () => resolve()));
    upstreamUrl = `http://127.0.0.1:${(upstreamServer.address() as AddressInfo).port}`;

    server = await startTestServer({
        controllers: [DeadlineController, AppDefaultController, UpstreamController, LeaseController, StoreController],
        dataSources: [dataSourceClass],
        providers
    });
    baseUrl = await server.start();

    const router: RouterInterface = inject(ZIBRI_DI_TOKENS.ROUTER);
    router.registerRoute({
        httpMethod: HttpMethod.GET,
        route: '/manual/slow',
        openApi: { useInOpenApi: false },
        timeoutInMs: 50,
        handler: async () => {
            await wait(400);
            return { ok: true };
        }
    });
    router.registerRoute({
        httpMethod: HttpMethod.GET,
        route: '/manual/inherits',
        openApi: { useInOpenApi: false },
        handler: async () => {
            await wait(400);
            return { ok: true };
        }
    });
}, 30000);

afterAll(async () => {
    await server?.shutdown();
    upstreamServer?.closeAllConnections();
    await new Promise<void>(resolve => {
        if (!upstreamServer) {
            resolve();
            return;
        }
        upstreamServer.close(() => resolve());
    });
}, 30000);

describe('a route that runs longer than its deadline', () => {

    it('answers 504 rather than holding the caller', async () => {
        const res: Response = await fetch(`${baseUrl}/deadline/inherits`);

        expect(res.status).toBe(HttpStatus.GATEWAY_TIMEOUT);
        const body: ErrorResponseBody = await res.json() as ErrorResponseBody;
        expect(body.status).toBe(HttpStatus.GATEWAY_TIMEOUT);
        expect(body.name).toBe('GatewayTimeoutError');
        // the trace the caller quotes to find the log lines this request wrote, which is the only
        // way to look up a request whose handler never reported anything itself
        expect(body.traceId).toEqual(expect.any(String));
    }, 10000);

    it('answers before the handler has finished', async () => {
        records.delete('inherits');
        const start: number = Date.now();

        const res: Response = await fetch(`${baseUrl}/deadline/inherits`);
        await res.arrayBuffer();

        // the handler waits 400ms and the deadline is 50ms. Answering only once the handler is done
        // would be a deadline that reports rather than one that bounds anything
        expect(Date.now() - start).toBeLessThan(300);
    }, 10000);

    it('aborts the signal on the request context', async () => {
        records.delete('inherits');

        await fetch(`${baseUrl}/deadline/inherits`);
        // the handler runs on past the response, so the record only exists once it does
        await wait(500);

        expect(records.get('inherits')).toEqual({ signalAborted: true, finished: true });
    }, 10000);

    it('stays up when the abandoned handler fails later', async () => {
        const timedOut: Response = await fetch(`${baseUrl}/deadline/throws-late`);
        expect(timedOut.status).toBe(HttpStatus.GATEWAY_TIMEOUT);

        // a Promise.race drops its loser, and a loser that rejects with nobody left to catch it is
        // an unhandled rejection - which this process turns into an exit
        await wait(400);
        const after: Response = await fetch(`${baseUrl}/deadline/fast`);

        expect(after.status).toBe(200);
    }, 10000);
});

describe('a route that finishes inside its deadline', () => {

    it('answers normally', async () => {
        const res: Response = await fetch(`${baseUrl}/deadline/fast`);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
    }, 10000);

    it('leaves the signal alone', async () => {
        records.delete('fast');

        await fetch(`${baseUrl}/deadline/fast`);

        // a signal that fires when a handler simply finished would abort whatever the handler
        // handed on to it - the stream it returned, the request it left running
        expect(records.get('fast')).toEqual({ signalAborted: false, finished: true });
    }, 10000);
});

describe('which deadline a route gets', () => {

    it('takes its own over its controller\'s', async () => {
        const res: Response = await fetch(`${baseUrl}/deadline/own`);

        // 200ms of work, 50ms on the controller, a second on the route
        expect(res.status).toBe(200);
    }, 10000);

    it('takes its controller\'s when it declares none', async () => {
        const res: Response = await fetch(`${baseUrl}/deadline/inherits`);

        // the application allows 80ms, the controller 50ms, and the handler takes 400ms - so a
        // controller that was ignored would still produce a 504 here. What this pins is that the
        // route is bounded by something other than the application default, which the timing case
        // above measures
        expect(res.status).toBe(HttpStatus.GATEWAY_TIMEOUT);
    }, 10000);

    it('takes the application\'s when neither says anything', async () => {
        const res: Response = await fetch(`${baseUrl}/app-default/slow`);

        expect(res.status).toBe(HttpStatus.GATEWAY_TIMEOUT);
    }, 10000);

    it('runs unbounded when the route says none', async () => {
        const res: Response = await fetch(`${baseUrl}/deadline/none`);

        // 200ms of work under an application that allows 80ms and a controller that allows 50ms
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
    }, 10000);

    it('bounds a manually registered route by what it declared', async () => {
        const res: Response = await fetch(`${baseUrl}/manual/slow`);

        expect(res.status).toBe(HttpStatus.GATEWAY_TIMEOUT);
    }, 10000);

    it('bounds a manually registered route that declares nothing by the application default', async () => {
        const res: Response = await fetch(`${baseUrl}/manual/inherits`);

        expect(res.status).toBe(HttpStatus.GATEWAY_TIMEOUT);
    }, 10000);
});

describe('what the deadline reaches', () => {

    it('ends an upstream call the http client is still waiting on', async () => {
        upstreamRecords.length = 0;
        records.delete('upstream');
        records.delete('upstream-failed');

        const res: Response = await fetch(`${baseUrl}/upstream/slow`);
        expect(res.status).toBe(HttpStatus.GATEWAY_TIMEOUT);

        // past the upstream's own 600ms, so it has answered by now if it was going to
        await wait(800);

        // the client's own timeout is ten seconds and the route's deadline is 80ms, so the deadline
        // is the shorter of the two and has to be the one that ends the call
        expect(records.get('upstream-failed')).toEqual({ signalAborted: true, finished: true });
        expect(records.get('upstream')).toBeUndefined();
        // and the socket to the upstream was actually let go, rather than the answer being read and
        // thrown away - an upstream holding a connection for a caller that has gone is the cost
        expect(upstreamRecords).toEqual([]);
    }, 15000);

    it('stops a handler reading the store once it has been answered for', async () => {
        queriesAfterDeadline = undefined;

        const res: Response = await fetch(`${baseUrl}/store/keeps-reading`);
        expect(res.status).toBe(HttpStatus.GATEWAY_TIMEOUT);

        // the handler asks for eight reads at 40ms apart under an 80ms deadline, so six of them are
        // for a caller that has already been answered. One query cannot be taken back; the rest can
        // simply not be made
        await wait(600);
        expect(queriesAfterDeadline).toBe(0);
    }, 15000);

    it('ends a wait for a lease somebody else is holding', async () => {
        records.delete('lease');
        records.delete('lease-failed');
        waitedForLeaseMs = undefined;

        const leases: LeaseServiceInterface = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
        // held for the whole of the case, so the route can never take it
        const holder: Promise<unknown> = leases.withLease(
            { key: 'deadline-contended', leaseInMs: 60_000 },
            async () => await wait(1500)
        );

        const res: Response = await fetch(`${baseUrl}/lease/contended`);
        expect(res.status).toBe(HttpStatus.GATEWAY_TIMEOUT);

        await wait(300);
        expect(records.get('lease-failed')).toEqual({ signalAborted: true, finished: true });
        // the route asked to queue for up to ten seconds, and its own deadline is 80ms. Without the
        // deadline reaching it, this contends for a grant it would immediately hand back
        expect(waitedForLeaseMs).toBeLessThan(1000);

        await holder;
    }, 20000);
});

describe('what a deadline does not cover', () => {

    it('lets a response finish being written', async () => {
        const res: Response = await fetch(`${baseUrl}/deadline/slow-stream`);
        const body: string = await res.text();

        // the handler returned at once and the body takes 150ms to write, under a 50ms deadline.
        // Cutting a response off part way through is what the framework does when a stream fails,
        // and a client cannot tell that from a body that is merely late
        expect(res.status).toBe(200);
        expect(body).toBe('chunk-0\nchunk-1\nchunk-2\nchunk-3\nchunk-4\n');
    }, 10000);
});