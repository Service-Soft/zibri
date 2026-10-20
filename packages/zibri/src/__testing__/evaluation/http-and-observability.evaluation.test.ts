import { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestHandler } from 'express';

import { ZibriApplication } from '../../application/application.ts';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ZIBRI_DI_PROVIDERS } from '../../di/default/zibri-di-providers.default.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { type DiProviderWithoutToken } from '../../di/models/di-provider.model.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { ValidationError } from '../../error-handling/errors/validation.error.ts';
import { HttpMethod } from '../../http/http-method.enum.ts';
import { HttpRequest } from '../../http/http-request.model.ts';
import { KnownHeader } from '../../http/known-header.enum.ts';
import { MiddlewarePhase } from '../../http/middleware-phase.enum.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { File } from '../../parsing/form-data/file.model.ts';
import { FormDataBodyParserCleanupCronJob } from '../../parsing/form-data/form-data-body-parser-cleanup.cron-job.ts';
import { CLEANUP_AT_FILE_NAME } from '../../parsing/form-data/form-data.model.ts';
import { BodyMetadata } from '../../routing/decorators/body-metadata.model.ts';
import { resolveBodyMetadata } from '../../routing/resolve-body-metadata.function.ts';
import { type RouterInterface } from '../../routing/router.interface.ts';
import { type TraceBufferInterface } from '../../tracing/trace-buffer.interface.ts';
import { TraceContextUtilities } from '../../tracing/trace-context.utilities.ts';
import { TraceSpanKind } from '../../tracing/trace-span-kind.enum.ts';
import { type TraceSpanRecord } from '../../tracing/trace-span-record.model.ts';
import { TracingUtilities } from '../../tracing/tracing.utilities.ts';
import { Newable } from '../../types/newable.type.ts';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { Ms } from '../../utilities/ms.ts';
import { resolveAppRoot } from '../../utilities/resolve-app-root.function.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { ValidationServiceInterface } from '../../validation/validation-service.interface.ts';
import { createTestDataSource } from '../test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

/**
 * Executable form of evaluation/02-http-runtime-core.md.
 *
 * Observations are real HTTP round trips, injected values and process state. Findings proven in a
 * file of their own - because they need a registry read, a signal or a second process - are comments
 * naming that file rather than assertions about how the source is written.
 *
 * Every expectation describes the fixed behavior, so this file is red until the corresponding
 * finding is closed. See ./README.md for why.
 */

const srcDir: FsPath = FsUtilities.getPath(import.meta.dirname, '..', '..');

/**
 * The real cleanup job, with the logger its init would otherwise have handed it.
 *
 * A cron job is not an injectable - the application rejects one that is marked `@Injectable` - and
 * `init` does a great deal more than this test wants. Everything under test is the untouched
 * `onTick` of the class it extends.
 */
class TestCleanupCronJob extends FormDataBodyParserCleanupCronJob {
    constructor(tempPath: FsPath, logger: LoggerInterface) {
        super(tempPath);
        this.logger = logger;
    }
}

/**
 * What the inner request of the trace propagation test saw.
 *
 * A model rather than a raw string, because the http client only fills `body` in for a call that
 * declared one - `rawBody` is what a call without a model gets, and reading that instead would be a
 * test written around the client rather than through it.
 */
class TraceEcho {
    @Property.string({ required: false })
    seen: string | undefined | null;
}
/**
 * A trace a caller is already recording under, in the shape the standard writes it.
 *
 * Fixed rather than generated, so what an assertion compares is a value this file chose and the
 * application had no way to produce by itself.
 */
const callerTraceId: string = '0af7651916cd43dd8448eb211c80319c';

/**
 * What the application kept of one trace, once it has finished keeping it.
 *
 * A request's span ends when its response closes, which is after the caller already has its answer,
 * so asking the moment a fetch resolves can be asking a moment too early.
 * @param traceId - The trace to read back.
 * @param expected - How many spans it should hold before the answer is complete.
 * @returns What the buffer holds of that trace, oldest first.
 */
async function findRecordedTrace(traceId: string, expected: number): Promise<TraceSpanRecord[]> {
    const buffer: TraceBufferInterface = inject(ZIBRI_DI_TOKENS.TRACE_BUFFER);
    for (let attempt: number = 0; attempt < 50; attempt++) {
        const spans: TraceSpanRecord[] = buffer.findSpansOfTrace(traceId);
        if (spans.length >= expected) {
            return spans;
        }
        await new Promise<void>(resolve => setTimeout(resolve, 20));
    }
    return buffer.findSpansOfTrace(traceId);
}

/**
 * The trace a response says it was answered in.
 *
 * Parsed with the framework's own reader rather than by splitting on hyphens, because what a caller
 * has to be able to do with that header is exactly what this does.
 * @param res - The response.
 * @returns The trace id, or undefined when the response named no trace.
 */
function findTraceId(res: Response): string | undefined {
    return TraceContextUtilities.findSpanContext({
        traceparent: res.headers.get(KnownHeader.TRACERESPONSE) ?? undefined
    })?.traceId;
}

/**
 * The body of the upload routes M10 drives.
 *
 * Every property optional, because the point of those requests is what the parser refuses before a
 * single one of them is validated.
 */
class EvalUpload {
    @Property.string({ required: false })
    label: string | undefined | null;

    @Property.file({ allowedMimeTypes: 'all', maxSize: '1mb', required: false })
    file: File | undefined | null;
}

/**
 * The same as {@link fastestOfThree} for a route, since a request cannot be measured synchronously.
 * @param url - The route to ask.
 * @returns The duration in milliseconds.
 */
async function fastestOfThreeRequests(url: string): Promise<number> {
    let best: number = Number.POSITIVE_INFINITY;
    for (let i: number = 0; i < 3; i++) {
        best = Math.min(best, await timeToFirstByte(url));
    }
    return best;
}

/**
 * A response body large enough that serializing it is what the request costs.
 *
 * Many small values rather than a few big ones, because the cost M2 is about is per value: the
 * replacer that turns a bigint into a string is a callback V8 has to make for every key it writes.
 * The bigint is here for the same reason it is anywhere - it is why the replacer exists at all.
 */
const largeJsonPayload: { rows: { id: string, name: string, amount: bigint, active: boolean, tags: string[] }[] } = {
    rows: Array.from({ length: 20000 }, (_, i) => ({
        id: `row-${i}`,
        name: `a name that is long enough to be worth writing out ${i}`,
        amount: BigInt(i) * 1000n,
        active: i % 2 === 0,
        tags: ['alpha', 'beta', 'gamma']
    }))
};

/**
 * How long the fastest of three runs of the given work takes.
 *
 * The fastest rather than the average: every sample here measures the same deterministic work, so a
 * slower one only ever means something else happened - a collection, another test's timer - and
 * taking the best of three is what keeps that out of the comparison.
 * @param work - What to measure.
 * @returns The duration in milliseconds.
 */
function fastestOfThree(work: () => void): number {
    let best: number = Number.POSITIVE_INFINITY;
    for (let i: number = 0; i < 3; i++) {
        const start: number = performance.now();
        work();
        best = Math.min(best, performance.now() - start);
    }
    return best;
}

/**
 * What a client sends to be answered with the body the route produced, and nothing else.
 *
 * The M2 cases below are about how many times a result is serialized, and an encoder in front of the
 * answer is a second thing to measure and a different body to compare against. Compression has its
 * own cases under M11.
 */
const PLAIN: string = 'identity';

/**
 * How long a route takes to produce the first byte of its answer.
 *
 * The whole round trip cannot say what a response costs to build: the body is megabytes, and reading
 * it back costs about what serializing it did, so the two implementations being told apart here are
 * a few milliseconds apart inside a measurement carrying ten of somebody else's. A json response is
 * written in one piece, so the first byte leaves only once it has been serialized in full - which
 * puts the whole of the work on this side of the clock and none of the transfer.
 *
 * The rest is drained rather than abandoned, so the connection stays reusable for the next sample.
 * @param url - The route to ask.
 * @returns The duration in milliseconds.
 */
async function timeToFirstByte(url: string): Promise<number> {
    const start: number = performance.now();
    const res: Response = await fetch(url, { headers: { 'accept-encoding': PLAIN } });
    if (!res.body) {
        throw new Error(`${url} answered without a body`);
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> = res.body.getReader();
    await reader.read();
    const duration: number = performance.now() - start;

    let done: boolean = false;
    while (!done) {
        done = (await reader.read()).done;
    }
    return duration;
}

/**
 * A middleware that writes down that it ran, in the order the pipeline reached it.
 *
 * A response header rather than anything held on the side, because what is being asserted is the
 * order one request went through - and a module level array would be shared with every other request
 * the suite makes in parallel.
 * @param name - What this one is called in the assertion.
 * @returns The middleware.
 */
function recordPhase(name: string): RequestHandler {
    return (_req, res, next) => {
        const soFar: string | number | string[] | undefined = res.getHeader('x-eval-pipeline');
        res.setHeader('x-eval-pipeline', soFar == undefined ? name : `${String(soFar)},${name}`);
        next();
    };
}

let server: StartedTestServer | undefined;
let baseUrl: string;
let rejectionListenersBeforeStart: number = 0;
let exceptionListenersBeforeStart: number = 0;

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource();

beforeAll(async () => {
    // captured before the application exists, so the test runner's own handlers are not counted as Zibri's
    rejectionListenersBeforeStart = process.listenerCount('unhandledRejection');
    exceptionListenersBeforeStart = process.listenerCount('uncaughtException');

    server = await startTestServer({ dataSources: [dataSourceClass] });

    // the one window where middleware can be added: the application exists and has been initialized,
    // and the pipeline is assembled by `start` below. Both are registered in the reverse of the order
    // they have to run in, so a passing assertion is the phase deciding and not the call order
    const app: ZibriApplication = server['app'];
    app.use(recordPhase('before-routing'), MiddlewarePhase.BEFORE_ROUTING);
    app.use(recordPhase('security'), MiddlewarePhase.SECURITY);
    app.use(
        (req, res, next) => {
            // what the phase is *for*: cookies are parsed one phase above this one, so a middleware
            // here can read them. This used to depend on which lifecycle hook registered it
            res.setHeader('x-eval-saw-cookies', String((req as HttpRequest).cookies != undefined));
            next();
        },
        MiddlewarePhase.BEFORE_ROUTING
    );

    baseUrl = await server.start();

    // routes rather than controllers, because none of them exist for their own sake: two observe a
    // header on the way in and on the way back out, two take an upload nobody intends to keep
    const router: RouterInterface = inject(ZIBRI_DI_TOKENS.ROUTER);
    router.registerRoute({
        httpMethod: HttpMethod.GET,
        route: '/eval-trace/echo',
        openApi: { useInOpenApi: false },
        // the trace id rather than the whole traceparent, and read through the framework's own api
        // rather than off the header: an application asks where it is, and the answer has to be the
        // same for every request of one trace, which is the entire point of the id. The span id
        // beside it is new per request and would make two requests of one trace look unrelated.
        handler: () => ({ seen: TracingUtilities.getCurrentTraceContext()?.traceId })
    });
    // an upload route with a generous byte budget, so what refuses a request here is a count rather
    // than a size - which is the whole of M10's first half
    router.registerRoute({
        httpMethod: HttpMethod.POST,
        route: '/eval-upload/counted',
        openApi: { useInOpenApi: false },
        bodyMetadata: { modelClass: EvalUpload, type: MimeType.FORM_DATA, baseMaxSize: '10mb' },
        handler: () => ({ accepted: true })
    });
    // and one with almost no budget, to refuse a body that is still arriving
    router.registerRoute({
        httpMethod: HttpMethod.POST,
        route: '/eval-upload/tiny',
        openApi: { useInOpenApi: false },
        bodyMetadata: { modelClass: EvalUpload, type: MimeType.FORM_DATA, baseMaxSize: '10b' },
        handler: () => ({ accepted: true })
    });
    router.registerRoute({
        httpMethod: HttpMethod.GET,
        route: '/eval-json/large',
        openApi: { useInOpenApi: false },
        handler: () => largeJsonPayload
    });
    // the same route with nothing to serialize, so what a request costs before any of this is a
    // measurement rather than an allowance
    router.registerRoute({
        httpMethod: HttpMethod.GET,
        route: '/eval-json/empty',
        openApi: { useInOpenApi: false },
        handler: () => ({ rows: [] })
    });
    // one path under two methods, so that a third is a verb this path does not answer rather than a
    // path that does not exist
    router.registerRoute({
        httpMethod: HttpMethod.GET,
        route: '/eval-methods/thing',
        openApi: { useInOpenApi: false },
        handler: () => ({ read: true })
    });
    router.registerRoute({
        httpMethod: HttpMethod.POST,
        route: '/eval-methods/thing',
        openApi: { useInOpenApi: false },
        handler: () => ({ written: true })
    });
    // a route that says what it answers with, which is what makes refusing possible at all
    router.registerRoute({
        httpMethod: HttpMethod.GET,
        route: '/eval-negotiation/json',
        openApi: { useInOpenApi: true, responses: [{ type: 'json' }], tags: [] },
        handler: () => ({ declared: true })
    });
    // and one that says nothing, which has to stay answerable by anybody
    router.registerRoute({
        httpMethod: HttpMethod.GET,
        route: '/eval-negotiation/undeclared',
        openApi: { useInOpenApi: false },
        handler: () => ({ declared: false })
    });
    // the trap the rule about implicit responses exists for: everything here was added by the
    // framework rather than by whoever wrote the route, so the route still declared nothing
    router.registerRoute({
        httpMethod: HttpMethod.GET,
        route: '/eval-negotiation/implicit-only',
        openApi: { useInOpenApi: true, responses: [{ type: 'json', implicit: true }], tags: [] },
        handler: () => ({ declared: false })
    });
    router.registerRoute({
        httpMethod: HttpMethod.GET,
        route: '/eval-trace/call',
        openApi: { useInOpenApi: false },
        // the framework's own client, calling back into the framework's own server: whatever the
        // inner request saw is what a downstream service would have seen
        handler: async () => (
            await inject(ZIBRI_DI_TOKENS.HTTP_CLIENT).get(
                `${baseUrl}/eval-trace/echo`,
                { responseBody: TraceEcho }
            )
        ).body
    });
}, 60000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 30000);

describe('evaluation/02-http-runtime-core', () => {

    describe('C1 - CORS must be configurable', () => {
        // No case for "the default is not `*`". The finding asked for one and the fix declined it:
        // `origins` defaults to `'*'` with `credentials: false`, so a browser attaches no cookies and
        // a cross origin page still needs a token somebody deliberately handed it. Restricting by
        // default would break every existing application to guard against something the default does
        // not permit. What was missing was the ability to lock it down at all, and that is held by
        // `src/http/cors.middleware.test.ts` - which drives a real server for each option, because
        // what matters is the headers on the wire. `credentials: true` beside `origins: '*'` throws
        // at startup rather than presenting the loosest configuration while silently disabling
        // cookie auth.

        it('allows PATCH, which the framework itself routes', async () => {
            const res: Response = await fetch(`${baseUrl}/does-not-exist`, {
                method: 'OPTIONS',
                headers: {
                    origin: 'https://app.example',
                    'access-control-request-method': 'PATCH'
                }
            });
            const allowed: string = (res.headers.get('access-control-allow-methods') ?? '').toUpperCase();

            // @Patch routes exist, so a browser preflight for PATCH must not be rejected
            expect(allowed).toContain('PATCH');
        });

        it('allows the headers the framework itself requires clients to send', async () => {
            const res: Response = await fetch(`${baseUrl}/does-not-exist`, {
                method: 'OPTIONS',
                headers: {
                    origin: 'https://app.example',
                    'access-control-request-method': 'POST'
                }
            });
            const allowed: string = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();

            // a cross origin client that cannot send these cannot use CSRF protection or 2FA at all
            expect(allowed).toContain('x-csrf-token');
            expect(allowed).toContain('x-authorization-otp');
        });

        it('does not answer OPTIONS for a route that was never registered', async () => {
            const res: Response = await fetch(`${baseUrl}/definitely-not-a-route`, { method: 'OPTIONS' });

            // only a real preflight is answered by the cors middleware, and only a path the router
            // knows is answered by the one that reports what a path allows. Neither is true here, so
            // this is a request for something that does not exist and says so
            expect(res.status).not.toBe(200);
            expect(res.status).toBe(404);
        });
    });

    describe('C3 - graceful shutdown', () => {
        // No cases for `/health/ready` and `/health/live`. The readiness half of the finding was
        // withdrawn rather than fixed, so an endpoint here would be a route the framework forces on
        // every application to expose a flag it already has: `start()` runs the `onAppStart` hooks
        // and only then listens, so there is no window where the server accepts connections while
        // the application is still starting, and shutdown readiness is one boolean any project can
        // read from a controller of its own through `GlobalRegistry.isAppShuttingDown()`.
        //
        // A 503-during-drain was built and reverted with it. `server.close()` stops the listener, so
        // a new connection is refused by the kernel and no middleware runs to answer anything - and
        // the window where it *would* be reachable is exactly the one that must keep serving
        // normally, because a load balancer that has not finished removing the instance is still
        // routing correct traffic to it.
        //
        // What did get fixed is held elsewhere: the bounded drain and the leases it releases are
        // `cluster/shutdown.cluster.test.ts`, and the exit is ../../application/application.shutdown.test.ts -
        // a shutdown by a call leaves the process running, and one by a signal exits 1 when a
        // teardown failed. It used to exit unconditionally, and 0 whatever the hooks did.
    });

    // C5 (listen errors must reach the caller) lives in ./bootstrap.evaluation.test.ts, because it
    // needs a server of its own and startTestServer resets the DI singleton.

    describe('C6 - upload temp files', () => {
        it('does not default the upload directory into the installed package', () => {
            // the *default*, read off the provider record rather than injected: the harness
            // overrides this token with a scratch directory of its own, which lives under the
            // project's own test folder on purpose, so injecting it here reports where this suite
            // writes rather than what an application would get.
            const provider: DiProviderWithoutToken<FsPath> = ZIBRI_DI_PROVIDERS.FILE_UPLOAD_TEMP_FOLDER;
            if (provider.useFactory == undefined) {
                // a value would be resolved when this module is loaded, which is the thing that put
                // the folder next to the framework in the first place
                throw new Error('the upload folder has to come from a factory, so that it resolves against the running application');
            }
            const tempFolder: FsPath = provider.useFactory();

            // this used to be getPath(__dirname, 'temp'), which in a real install resolves to
            // node_modules/zibri/dist/di/default/temp - that breaks on a read-only image, and
            // otherwise puts user uploads in the dependency tree where npm ci wipes them
            expect(tempFolder.startsWith(srcDir)).toBe(false);
            expect(tempFolder.startsWith(resolveAppRoot())).toBe(true);
        });

        it('removes an expired upload folder and leaves a live one alone', async () => {
            const root: FsPath = inject(ZIBRI_DI_TOKENS.FILE_UPLOAD_TEMP_FOLDER);
            const expired: FsPath = FsUtilities.getPath(root, `temp-${UUIDUtilities.generate()}`);
            const live: FsPath = FsUtilities.getPath(root, `temp-${UUIDUtilities.generate()}`);

            await FsUtilities.createFile(FsUtilities.getPath(expired, CLEANUP_AT_FILE_NAME), `${Date.now() - Ms.HOUR}`);
            await FsUtilities.createFile(FsUtilities.getPath(live, CLEANUP_AT_FILE_NAME), `${Date.now() + Ms.HOUR}`);

            try {
                await new TestCleanupCronJob(root, inject(ZIBRI_DI_TOKENS.LOGGER)).onTick();

                // hasRecentlyBeenCreated returns `Date.now() > cleanupAtMs`, which is true once a
                // folder has *expired* - and the caller then treats that as "preserve". The
                // comparison runs the wrong way round in both directions at once.
                expect({ expiredStillThere: await FsUtilities.exists(expired) })
                    .toEqual({ expiredStillThere: false });

                // the more serious half. A folder is removed while it is still live, and the same
                // branch is taken when the cleanupAt file cannot be read yet - which is an upload
                // still being written, deleted underneath the request handling it.
                expect({ liveWasDeleted: !await FsUtilities.exists(live) })
                    .toEqual({ liveWasDeleted: false });
            }
            finally {
                await FsUtilities.rm(expired).catch(() => undefined);
                await FsUtilities.rm(live).catch(() => undefined);
            }
        });
    });

    // M6 (a 5xx must be diagnosable from the logs) is observed for real in
    // ./error-logging.evaluation.test.ts, against the rows the db log transport persisted.

    describe('M2 - a json response must be serialized once', () => {
        it('answers with what one pass over the result produces', async () => {
            // a control, and the guard on the rewrite: writing the string directly rather than
            // through res.json has to keep the content type and the body it used to send, including
            // a bigint arriving as a string - which is the whole reason the framework serializes
            // with a replacer of its own instead of leaving it to express
            const res: Response = await fetch(`${baseUrl}/eval-json/large`, { headers: { 'accept-encoding': PLAIN } });

            expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
            expect(await res.text()).toBe(JsonUtilities.stringify(largeJsonPayload));
        }, 30000);

        it('costs one pass rather than three', async () => {
            // both candidate implementations, measured on this machine at this moment: the one the
            // framework should be doing, and the round trip it used to hand to res.json. Comparing
            // against the midpoint is what makes this a statement about the framework rather than
            // about how fast the machine running it happens to be - a threshold in milliseconds
            // would say something different on every laptop.
            const onePass: number = fastestOfThree(() => void JsonUtilities.stringify(largeJsonPayload));
            const threePasses: number = fastestOfThree(
                () => void JsonUtilities.stringify(JsonUtilities.parse(JsonUtilities.stringify(largeJsonPayload)))
            );

            // warmed first, or the measured request pays for compiling everything on the way
            await timeToFirstByte(`${baseUrl}/eval-json/large`);
            await timeToFirstByte(`${baseUrl}/eval-json/empty`);

            // what the same request costs with nothing to serialize: a connection, express, the
            // middleware chain and the router. That is a constant of the machine rather than of the
            // implementation, and leaving it in compares a round trip against two function calls -
            // which is how a correct implementation lands just over the midpoint on a slower host
            const overhead: number = await fastestOfThreeRequests(`${baseUrl}/eval-json/empty`);
            const answered: number = await fastestOfThreeRequests(`${baseUrl}/eval-json/large`);

            expect(answered - overhead).toBeLessThan((onePass + threePasses) / 2);
        }, 60000);
    });

    describe('M7 - trace context', () => {
        // The finding asked for correlation ids and this closes it by deleting them. A correlation
        // id and a trace id are one thing under two names - a value every service handling one
        // operation shares, which joins their log lines and survives being pasted into a ticket -
        // and the standard one carries a span id and a sampling decision besides, which the private
        // one had no answer for. So there is no `x-correlation-id` anywhere any more, and these
        // cases ask the same questions of `traceparent` that they used to ask of it.

        it('continues a trace the caller started', async () => {
            const res: Response = await fetch(`${baseUrl}/does-not-exist`, {
                headers: { traceparent: `00-${callerTraceId}-b7ad6b7169203331-01` }
            });

            // the id the caller is already writing on its own log lines. Starting a new one here
            // would leave two services with two stories about one request, which is the state the
            // finding was filed about
            expect(findTraceId(res)).toBe(callerTraceId);
        });

        it('starts one when the caller did not send any', async () => {
            const res: Response = await fetch(`${baseUrl}/does-not-exist`);

            // a request that arrived from outside is exactly where no upstream service can supply
            // one, so a trace that only ever continued would be missing from every entry point
            expect(res.headers.get('traceresponse')).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/);
        });

        it('names the trace in the body of an error, where somebody filing a ticket will copy it', async () => {
            const res: Response = await fetch(`${baseUrl}/does-not-exist`, {
                headers: { traceparent: `00-${callerTraceId}-b7ad6b7169203331-01` }
            });
            const body: { traceId?: string } = await res.json() as { traceId?: string };

            // a header is only useful to whoever was watching the network tab. The id has to survive
            // being pasted into a bug report, which is the form it actually reaches an engineer in.
            expect(body.traceId).toBe(callerTraceId);
        });

        it('passes it on to a request the application makes while handling one', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-trace/call`, {
                headers: { traceparent: `00-${callerTraceId}-b7ad6b7169203331-01` }
            });
            const body: { seen?: string } = await res.json() as { seen?: string };

            // what makes an id worth having: a call fanning out to three services otherwise produces
            // four sets of logs that nothing joins, which is the moment somebody needs them joined
            expect(body.seen).toBe(callerTraceId);
        });

        it('keeps the spans of what it did, where the application itself can read them', async () => {
            const traceId: string = '1af7651916cd43dd8448eb211c80319c';
            await fetch(`${baseUrl}/eval-trace/echo`, {
                headers: { traceparent: `00-${traceId}-b7ad6b7169203331-01` }
            });

            const [request]: TraceSpanRecord[] = await findRecordedTrace(traceId, 1);

            // no collector, no exporter, nothing listening anywhere: an application that configured
            // none of that can still be asked what it has been doing, out of memory it bounds itself
            expect(request?.name).toBe('GET /eval-trace/echo');
            expect(request?.kind).toBe(TraceSpanKind.SERVER);
            expect(request?.attributes['http.response.status_code']).toBe(200);
            expect(request?.durationMs).toBeGreaterThanOrEqual(0);
        });

        it('keeps a call it made under the request that made it', async () => {
            const traceId: string = '2af7651916cd43dd8448eb211c80319c';
            await fetch(`${baseUrl}/eval-trace/call`, {
                headers: { traceparent: `00-${traceId}-b7ad6b7169203331-01` }
            });

            // three: the request, the call it made while handling it, and the request that call
            // arrived as - this application calling itself, which is what the route is for
            const trace: TraceSpanRecord[] = await findRecordedTrace(traceId, 3);
            const kinds: TraceSpanKind[] = trace.map(span => span.kind);

            // the point of a trace rather than a log line per service: what the request spent its
            // time on is read off the shape, rather than guessed by lining up timestamps
            expect(kinds).toContain(TraceSpanKind.CLIENT);
            expect(kinds.filter(kind => kind === TraceSpanKind.SERVER)).toHaveLength(2);
            expect(new Set(trace.map(span => span.spanId)).size).toBe(trace.length);
        });

        it('hands on the trace it started itself, for a caller that sent none', async () => {
            const outer: Response = await fetch(`${baseUrl}/eval-trace/call`);
            const body: { seen?: string } = await outer.json() as { seen?: string };

            // the outer request's own trace, generated here and handed down - propagation is not
            // conditional on the caller having supplied one
            expect(body.seen).toBe(findTraceId(outer));
        });
    });

    // M9 - authorization failures must be 403, not 401 - is asserted in
    // ./auth-sessions-and-2fa.evaluation.test.ts, the suite with a login flow: it holds a token that
    // opened a role protected route and then takes the role away behind its back, which is the one
    // shape where the 403 is about the role rather than about the fixture. This suite has no logged
    // in caller to refuse. The 405 and 406 half of the original finding is carried as M14.

    describe('M10 - multipart parsing must be bounded', () => {
        it('accepts an ordinary upload', async () => {
            const form: FormData = new FormData();
            form.append('label', 'ordinary');
            form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');

            // the control: the limits below have to refuse a shape, not the route
            const res: Response = await fetch(`${baseUrl}/eval-upload/counted`, { method: 'POST', body: form });

            expect(res.status).toBe(200);
        }, 30000);

        it('refuses a body carrying more files than it will hold open', async () => {
            const form: FormData = new FormData();
            for (let i: number = 0; i < 40; i++) {
                form.append(`file-${i}`, new Blob(['x'], { type: 'text/plain' }), `f-${i}.txt`);
            }

            // busboy was constructed with no limits object at all, so the only guard was a byte
            // counter - and forty one-byte files weigh nothing. Each one opens a write stream while
            // it is being received, so a hundred thousand of them is EMFILE and a process that can
            // no longer accept a socket, all of it under any size limit.
            const res: Response = await fetch(`${baseUrl}/eval-upload/counted`, { method: 'POST', body: form });

            expect(res.status).toBe(413);
        }, 30000);

        it('refuses a body carrying more fields than it will parse', async () => {
            const form: FormData = new FormData();
            for (let i: number = 0; i < 600; i++) {
                form.append(`field-${i}`, 'x');
            }

            // the same shape without touching the disk: parsing work that costs the server without
            // ever weighing anything
            const res: Response = await fetch(`${baseUrl}/eval-upload/counted`, { method: 'POST', body: form });

            expect(res.status).toBe(413);
        }, 30000);

        it('answers an oversized body with a status instead of resetting the connection', async () => {
            const form: FormData = new FormData();
            form.append('file', new Blob(['x'.repeat(4 * 1024 * 1024)], { type: 'text/plain' }), 'big.txt');

            // big enough that the refusal lands while the body is still arriving, which is the only
            // case that ever reset: the parser destroyed the request stream, so the caller got an
            // ECONNRESET instead of the 413 and could not tell "too large" from a dropped network -
            // which means it retried
            const res: Response = await fetch(`${baseUrl}/eval-upload/tiny`, { method: 'POST', body: form });

            expect(res.status).toBe(413);
        }, 30000);
    });

    describe('M11 - baseline HTTP capabilities', () => {
        it('compresses a response when the client asks for it', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-json/large`, {
                headers: { 'accept-encoding': 'gzip' }
            });
            await res.arrayBuffer();

            expect(res.headers.get('content-encoding')).toBe('gzip');
            // a cache that kept this answer must not hand it to a client that reads no gzip, and this
            // is the only thing that tells it the two are different answers
            expect(res.headers.get('vary')?.toLowerCase()).toContain('accept-encoding');
            // what the client was told to expect was the plain body, and it is not getting that one
            expect(res.headers.get('content-length')).toBeNull();
        }, 30000);

        it('prefers brotli over gzip for a client that reads both', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-json/large`, {
                headers: { 'accept-encoding': 'gzip, br' }
            });
            await res.arrayBuffer();

            expect(res.headers.get('content-encoding')).toBe('br');
        }, 30000);

        it('leaves a response alone for a client that asked for no encoding', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-json/large`, {
                headers: { 'accept-encoding': 'identity' }
            });
            await res.arrayBuffer();

            // the control that keeps the three above about compression rather than about headers
            // being set on everything
            expect(res.headers.get('content-encoding')).toBeNull();
        }, 30000);

        it('leaves a response too small to be worth encoding alone', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-trace/echo`, {
                headers: { 'accept-encoding': 'gzip, br' }
            });
            await res.arrayBuffer();

            // a few dozen bytes, where the encoding header alone is most of what the client would
            // receive and the encoded body is usually the larger of the two
            expect(res.headers.get('content-encoding')).toBeNull();
        }, 30000);

        // the ETag row of M11 is held by *answers a conditional request with a 304* below, in the
        // block about the request method - which is what was actually keeping the framework from
        // producing one.

        it('configures server level timeouts', () => {
            if (!server) {
                throw new Error('the test server did not start');
            }
            const httpServer: Server = server['app'].server;

            // Node already defaults requestTimeout to 300000 and headersTimeout to 60000, so an
            // earlier `> 0` assertion here passed without the framework touching either of them.
            // Passing means Zibri deliberately narrowed them, which is what bounds a client that
            // holds a socket open by sending a byte every few seconds.
            expect(httpServer.requestTimeout).toBeGreaterThan(0);
            expect(httpServer.requestTimeout).toBeLessThan(300000);
            expect(httpServer.headersTimeout).toBeLessThan(60000);
            // and the headers have to run out before the request they belong to, or the narrower of
            // the two is never the one that fires
            expect(httpServer.headersTimeout).toBeLessThanOrEqual(httpServer.requestTimeout);
        });

        // every timeout above is cleared once the request has arrived, so none of them is what
        // bounds the handler it reached. That row is held by ../../http/request-deadline.utilities.test.ts,
        // which is in the normal suite because the row is closed.

        // trust proxy is never enabled, so req.ip is the load balancer for every request behind an
        // ingress. Observed for real in ./error-logging.evaluation.test.ts, which can read the
        // clientIp the framework recorded on a persisted log row.
    });

    describe('M12 - the order middleware runs in must be stated, not emergent', () => {
        it('runs a middleware where its phase puts it, not where it was registered', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-negotiation/undeclared`);

            // both were registered in beforeAll in the opposite order to this one. Before phases the
            // pipeline was whatever order the calls happened in, which for the framework's own
            // middleware meant the order the di container instantiated the services holding them
            expect(res.headers.get('x-eval-pipeline')).toBe('security,before-routing');
        });

        it('has parsed the cookies by the time a middleware before routing runs', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-negotiation/undeclared`);

            // the concrete defect the finding names: cookie parsing was registered after the
            // `onAppInit` hooks, so anything a service registered from there ran ahead of it and a
            // middleware that needed cookies had to know which hook not to use
            expect(res.headers.get('x-eval-saw-cookies')).toBe('true');
        });

        it('refuses a middleware added after the pipeline was assembled', () => {
            if (!server) {
                throw new Error('the test server did not start');
            }

            // it used to be accepted and then never run: express appends it behind the handler that
            // answers everything unmatched, so the middleware is registered, reachable by nothing,
            // and silent about both
            expect(() => server?.['app'].use(recordPhase('too-late'))).toThrow();
        });
    });

    describe('M14 - 405 and 406 must be produced', () => {
        it('answers a path it has with a method it does not', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-methods/thing`, { method: 'DELETE' });

            // the distinction a 404 cannot draw: this one is worth retrying with another verb, and a
            // route that does not exist never is
            expect(res.status).toBe(405);
        });

        it('names the methods that would have worked', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-methods/thing`, { method: 'DELETE' });

            // without this the status says the request was wrong and nothing says what would be
            // right, which is the whole of what a caller can act on
            const allow: string = res.headers.get('allow') ?? '';
            expect(allow).toContain('GET');
            expect(allow).toContain('POST');
            // never declared, and answered all the same: express serves a HEAD from the GET handler
            expect(allow).toContain('HEAD');
            expect(allow).not.toContain('DELETE');
        });

        it('still answers 404 for a path that does not exist', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-methods/nothing-here`, { method: 'DELETE' });

            // the control that keeps the two above about the method rather than about every
            // unmatched request having become a 405
            expect(res.status).toBe(404);
        });

        it('answers OPTIONS for a path it has with what that path allows', async () => {
            const options: Response = await fetch(`${baseUrl}/eval-methods/thing`, { method: 'OPTIONS' });
            const refused: Response = await fetch(`${baseUrl}/eval-methods/thing`, { method: 'DELETE' });

            expect(options.status).toBe(204);
            expect(options.headers.get('allow') ?? '').toContain('POST');
            // and the same list the 405 carries, because one rule produces both. Express generates an
            // Allow of its own for any path some layer matched, from its own idea of what that path
            // supports - two rules answering one question is how they come to disagree, so this
            // replaces it rather than sitting beside it
            expect(options.headers.get('allow')).toBe(refused.headers.get('allow'));
        });

        it('refuses a caller that accepts nothing the route produces', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-negotiation/json`, {
                headers: { accept: 'application/xml' }
            });

            // it used to answer 200 with a json body, so a client handed the wrong media type to its
            // parser and found out there rather than at the request
            expect(res.status).toBe(406);
        });

        it('answers a caller that accepts what the route produces', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-negotiation/json`, {
                headers: { accept: 'application/json' }
            });

            expect(res.status).toBe(200);
        });

        it('answers a caller that did not ask for anything in particular', async () => {
            const wildcard: Response = await fetch(`${baseUrl}/eval-negotiation/json`, {
                headers: { accept: '*/*' }
            });
            const silent: Response = await fetch(`${baseUrl}/eval-negotiation/json`);

            // every http client that never thought about the header sends one of these two, and
            // refusing either would be the negotiation refusing the ordinary case
            expect(wildcard.status).toBe(200);
            expect(silent.status).toBe(200);
        });

        it('leaves a route that declared nothing answerable by anybody', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-negotiation/undeclared`, {
                headers: { accept: 'application/xml' }
            });

            // refusing here would turn a route whose author never documented a response into one
            // that rejects callers, which is a documentation gap becoming a runtime failure
            expect(res.status).toBe(200);
        });

        it('does not let a response the framework added decide what a route produces', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-negotiation/implicit-only`, {
                headers: { accept: 'application/xml' }
            });

            // `@RateLimited({ reserveIfUnavailable: true })` documents the reservation it can answer
            // with, and a route carrying only that has still said nothing about what it produces.
            // Counting it would let a rate limit switch on content negotiation
            expect(res.status).toBe(200);
        });
    });

    describe('the method a request arrived with must survive being routed', () => {
        // The router used to lowercase `request.method` in its dispatch handler, so that the value
        // matched the framework's own lowercase HttpMethod enum. Every http method name is uppercase
        // and case sensitive, and express compares against literals - so the two cases below are not
        // about third party middleware, which is how the finding filed it. They are what the
        // framework did to itself. The enum now spells the methods the way the protocol does, and
        // nothing rewrites the request.

        it('answers a conditional request with a 304', async () => {
            // the same trace on both requests, because this route echoes the id of the one it is
            // answering in: left to itself the middleware starts a trace per request, so the body -
            // and with it the validator, which is a fact about the body and nothing else - is
            // different every time. A 200 would then be the correct answer and would prove nothing.
            const headers: Record<string, string> = { traceparent: `00-${callerTraceId}-b7ad6b7169203331-01` };

            const first: Response = await fetch(`${baseUrl}/eval-trace/echo`, { headers });
            const etag: string | null = first.headers.get('etag');
            await first.arrayBuffer();

            // express generates the validator inside the send every response goes through, so this
            // half was never missing - which is why M11 listing ETag as absent was half right for
            // the wrong reason
            expect(etag).toBeTruthy();

            const second: Response = await fetch(`${baseUrl}/eval-trace/echo`, {
                headers: {
                    ...headers,
                    'if-none-match': etag ?? '',
                    // what a browser sends when it revalidates, and here it also has to override
                    // something: node's fetch adds `cache-control: no-cache` by itself to any request
                    // carrying a conditional header, and a server that answered 304 to a no-cache
                    // request would be wrong. Without this the client is asking for the full body.
                    'cache-control': 'max-age=0'
                }
            });
            const body: string = await second.text();

            // `if ('GET' !== method && 'HEAD' !== method) return false` is the whole of express's
            // freshness check, and 'get' is not 'GET'. So the validator was sent, the client sent it
            // back, and every revalidation downloaded the entire body again.
            expect(second.status).toBe(304);
            expect(body.length).toBe(0);
        }, 30000);

        it('answers a HEAD with the headers of the answer and none of its body', async () => {
            const res: Response = await fetch(`${baseUrl}/eval-trace/echo`, { method: 'HEAD' });

            expect(res.status).toBe(200);
            // express decides whether to write the body with `req.method === 'HEAD'`, so a lowercased
            // method meant a HEAD was answered *with* one. A client that asks for the size of
            // something got the whole of it.
            expect((await res.text()).length).toBe(0);
        }, 30000);
    });

    describe('metrics must not be a cardinality bomb', () => {
        // CLOSED and proven for real in ../../metrics/metrics.service.test.ts, which reads the
        // labels back off the registry rather than needing a scrape endpoint: a request is labelled
        // with the route template, everything unmatched shares one label, and an abandoned request
        // is counted as 499 instead of going missing. `req.originalUrl` is always defined, so
        // `req.route?.path` was dead code and every distinct url became ~11 retained series with no
        // eviction - an unauthenticated remote OOM.
    });

    describe('the process must survive a rejected promise', () => {
        it('installs a process level unhandled rejection handler', () => {
            // socket.io middleware awaits outside its try/catch, so a malformed token during the
            // websocket handshake produces an unhandled rejection with no last line of defense
            expect(process.listenerCount('unhandledRejection')).toBeGreaterThan(rejectionListenersBeforeStart);
        });

        it('installs a process level uncaught exception handler', () => {
            expect(process.listenerCount('uncaughtException')).toBeGreaterThan(exceptionListenersBeforeStart);
        });
    });

    describe('MINOR - a declared regex runs on what a request sent', () => {
        it('checks a value against a pattern that backtracks in time linear to the value', async () => {
            class EvalCode {
                @Property.string({ regex: /^(a+)+$/ })
                code!: string;
            }
            const validation: ValidationServiceInterface = inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE);
            const metadata: BodyMetadata = resolveBodyMetadata({ modelClass: EvalCode }, 0);

            // a backtracking engine tries every way of splitting the a's between the two quantifiers
            // before it gives up on the `!`, which for 27 of them is 2^27 attempts - seconds, during
            // which the process answers nothing else. A linear one is done in microseconds, so the
            // margin below is a thousand times what it needs
            const start: number = performance.now();
            const validated: Promise<void> = Promise.resolve(validation.validateBody({ code: `${'a'.repeat(27)}!` }, metadata));
            await expect(validated).rejects.toThrow(ValidationError);
            const duration: number = performance.now() - start;

            expect(duration).toBeLessThan(100);
        });

        it('refuses a pattern it cannot run in linear time while the class is declared', () => {
            const declare: () => Function = () => {
                class EvalLookahead {
                    @Property.string({ regex: /^(?=\d)\w+$/ })
                    code!: string;
                }
                return EvalLookahead;
            };

            // refused at the declaration, so the first request is not where anybody finds out
            expect(declare).toThrow('EvalLookahead.code');
        });
    });
});