import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { type TraceBufferInterface } from './trace-buffer.interface';
import { TraceContextUtilities } from './trace-context.utilities';
import { TraceSpanKind } from './trace-span-kind.enum';
import { type TraceSpanRecord } from './trace-span-record.model';
import { TracingUtilities } from './tracing.utilities';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Property } from '../entity/decorators/property.decorator';
import { HttpMethod } from '../http/http-method.enum';
import { KnownHeader } from '../http/known-header.enum';
import { type RouterInterface } from '../routing/router.interface';

// a correlation id and a trace id are one thing under two names, and the standard one carries a span
// id and a sampling decision besides: so these ask of `traceparent` what a private correlation id
// would have been asked

/**
 * What the inner request of the propagation cases saw. A model, because the http client only fills
 * `body` in for a call that declared one.
 */
class TraceEcho {
    @Property.string({ required: false })
    seen: string | undefined | null;
}

/**
 * A trace a caller is already recording under. Fixed rather than generated, so what an assertion
 * compares is a value the application had no way to produce by itself.
 */
const callerTraceId: string = '0af7651916cd43dd8448eb211c80319c';

/**
 * The trace a response says it was answered in, read with the framework's own reader, since that is
 * what a caller has to be able to do with the header.
 * @param res - The response.
 * @returns The trace id, or undefined when the response named none.
 */
function findTraceId(res: Response): string | undefined {
    return TraceContextUtilities.findSpanContext({ traceparent: res.headers.get(KnownHeader.TRACERESPONSE) ?? undefined })?.traceId;
}

/**
 * What the application kept of one trace once it finished keeping it. A request's span ends when its
 * response closes, which is after the caller has its answer.
 * @param traceId - The trace to read back.
 * @param expected - How many spans it should hold once complete.
 * @returns What the buffer holds of the trace, oldest first.
 */
async function findRecordedTrace(traceId: string, expected: number): Promise<TraceSpanRecord[]> {
    const buffer: TraceBufferInterface = inject(ZIBRI_DI_TOKENS.TRACE_BUFFER);
    for (let attempt: number = 0; attempt < 50 && buffer.findSpansOfTrace(traceId).length < expected; attempt++) {
        await new Promise<void>(resolve => setTimeout(resolve, 20));
    }
    return buffer.findSpansOfTrace(traceId);
}

describe('the trace of a request', () => {
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
            route: '/trace/echo',
            openApi: { useInOpenApi: false },
            // the trace id read through the framework's own api, which has to answer the same for every
            // request of one trace; the span id beside it is new per request
            handler: () => ({ seen: TracingUtilities.getCurrentTraceContext()?.traceId })
        });
        router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/trace/call',
            openApi: { useInOpenApi: false },
            // the framework's own client calling back into its own server: what the inner request saw is
            // what a downstream service would have seen
            handler: async () => (await inject(ZIBRI_DI_TOKENS.HTTP_CLIENT).get(`${baseUrl}/trace/echo`, { responseBody: TraceEcho })).body
        });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    // starting a new one would leave two services with two stories about one request
    it('continues a trace the caller started', async () => {
        const res: Response = await fetch(`${baseUrl}/does-not-exist`, { headers: { [KnownHeader.TRACEPARENT]: `00-${callerTraceId}-b7ad6b7169203331-01` } });

        expect(findTraceId(res)).toBe(callerTraceId);
    });

    // a request from outside is exactly where no upstream service can supply one
    it('starts one when the caller sent none', async () => {
        expect((await fetch(`${baseUrl}/does-not-exist`)).headers.get(KnownHeader.TRACERESPONSE)).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/);
    });

    // a header is only useful to whoever watched the network tab: the id has to survive being pasted
    // into a bug report, the form it reaches an engineer in
    it('names the trace in the body of an error', async () => {
        const res: Response = await fetch(`${baseUrl}/does-not-exist`, { headers: { [KnownHeader.TRACEPARENT]: `00-${callerTraceId}-b7ad6b7169203331-01` } });

        expect((await res.json() as { traceId?: string }).traceId).toBe(callerTraceId);
    });

    // a call fanning out to three services otherwise leaves four sets of logs nothing joins
    it('passes it on to a request the application makes while handling one', async () => {
        const res: Response = await fetch(`${baseUrl}/trace/call`, { headers: { [KnownHeader.TRACEPARENT]: `00-${callerTraceId}-b7ad6b7169203331-01` } });

        expect((await res.json() as { seen?: string }).seen).toBe(callerTraceId);
    });

    // propagation is not conditional on the caller having supplied one
    it('hands on the trace it started itself, for a caller that sent none', async () => {
        const outer: Response = await fetch(`${baseUrl}/trace/call`);

        expect((await outer.json() as { seen?: string }).seen).toBe(findTraceId(outer));
    });

    // no collector, no exporter: an application that configured none can still be asked what it has
    // been doing, out of memory it bounds itself
    it('keeps the span of a request where the application itself can read it', async () => {
        const traceId: string = '1af7651916cd43dd8448eb211c80319c';
        await fetch(`${baseUrl}/trace/echo`, { headers: { [KnownHeader.TRACEPARENT]: `00-${traceId}-b7ad6b7169203331-01` } });

        const [request]: TraceSpanRecord[] = await findRecordedTrace(traceId, 1);

        expect(request?.name).toBe('GET /trace/echo');
        expect(request?.kind).toBe(TraceSpanKind.SERVER);
        expect(request?.attributes['http.response.status_code']).toBe(200);
        expect(request?.durationInMs).toBeGreaterThanOrEqual(0);
    });

    // what the request spent its time on is read off the shape of the trace, rather than guessed by
    // lining up timestamps: the request, the call it made, and the request that call arrived as
    it('keeps a call it made under the request that made it', async () => {
        const traceId: string = '2af7651916cd43dd8448eb211c80319c';
        await fetch(`${baseUrl}/trace/call`, { headers: { [KnownHeader.TRACEPARENT]: `00-${traceId}-b7ad6b7169203331-01` } });

        const trace: TraceSpanRecord[] = await findRecordedTrace(traceId, 3);
        const kinds: TraceSpanKind[] = trace.map(span => span.kind);

        expect(kinds).toContain(TraceSpanKind.CLIENT);
        expect(kinds.filter(kind => kind === TraceSpanKind.SERVER)).toHaveLength(2);
        expect(new Set(trace.map(span => span.spanId)).size).toBe(trace.length);
    });
});