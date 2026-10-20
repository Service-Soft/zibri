import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { OpenTelemetryApi, OpenTelemetryApiTracer, OpenTelemetryNodeSdk, OpenTelemetrySpan } from './open-telemetry-api.model.ts';
import { TraceBufferSpanProcessor } from './trace-buffer.span-processor.ts';
import { optionalPeer } from '../../utilities/optional-peer.function.ts';
import { InMemoryTraceBuffer } from '../in-memory.trace-buffer.ts';
import { TraceSpanKind } from '../trace-span-kind.enum.ts';
import { TraceSpanRecord } from '../trace-span-record.model.ts';
import { TraceSpanStatus } from '../trace-span-status.enum.ts';

/**
 * The real sdk recording into the real buffer, which is the only way to know that the two agree.
 *
 * A span the sdk built is the one thing this file is about: what a processor is handed is the sdk's
 * own shape, and a hand written stand-in for one would be this file agreeing with itself.
 */
const api: OpenTelemetryApi = optionalPeer<OpenTelemetryApi>('@opentelemetry/api', 'This test');
const sdk: OpenTelemetryNodeSdk = optionalPeer<OpenTelemetryNodeSdk>('@opentelemetry/sdk-trace-node', 'This test');

const buffer: InMemoryTraceBuffer = new InMemoryTraceBuffer(10);

beforeAll(() => {
    new sdk.NodeTracerProvider({ spanProcessors: [new TraceBufferSpanProcessor(buffer, api)] }).register();
});

beforeEach(() => {
    buffer.clear();
});

describe('TraceBufferSpanProcessor', () => {

    it('keeps a finished span, as what it turned out to be', () => {
        const span: OpenTelemetrySpan = api.trace.getTracer('zibri-test').startSpan('GET', {
            kind: api.SpanKind.SERVER,
            attributes: { 'http.request.method': 'GET' },
            root: true
        });
        span.updateName('GET /teams/:id');
        span.setAttributes({ 'http.response.status_code': 200 });
        span.end();

        const [recorded]: TraceSpanRecord[] = buffer.findRecentSpans();

        // the name it ended with rather than the one it started with: a request is named for the
        // route that matched, and the route is not known until it has
        expect(recorded?.name).toBe('GET /teams/:id');
        expect(recorded?.kind).toBe(TraceSpanKind.SERVER);
        expect(recorded?.attributes).toEqual({ 'http.request.method': 'GET', 'http.response.status_code': 200 });
        expect(recorded?.traceId).toMatch(/^[\da-f]{32}$/);
        expect(recorded?.spanId).toMatch(/^[\da-f]{16}$/);
        expect(recorded?.parentSpanId).toBeUndefined();
        expect(recorded?.status).toBe(TraceSpanStatus.UNSET);
    });

    it('keeps nothing for a span that has not finished', () => {
        api.trace.getTracer('zibri-test').startSpan('still running', { kind: api.SpanKind.INTERNAL, root: true });

        // a span is kept for its duration and its outcome, and neither exists yet. Keeping it on
        // start would also mean holding a reference to work still in flight
        expect(buffer.findRecentSpans()).toEqual([]);
    });

    it('records how a span ended, and what it was called when it went wrong', () => {
        const span: OpenTelemetrySpan = api.trace.getTracer('zibri-test')
            .startSpan('failing', { kind: api.SpanKind.INTERNAL, root: true });
        span.setStatus({ code: api.SpanStatusCode.ERROR, message: 'the database said no' });
        span.end();

        const [recorded]: TraceSpanRecord[] = buffer.findRecentSpans();

        expect(recorded?.status).toBe(TraceSpanStatus.ERROR);
        expect(recorded?.statusMessage).toBe('the database said no');
    });

    it('records when the work started and how long it took', () => {
        const before: number = Date.now();
        const span: OpenTelemetrySpan = api.trace.getTracer('zibri-test')
            .startSpan('measured', { kind: api.SpanKind.CLIENT, root: true });
        span.end();

        const [recorded]: TraceSpanRecord[] = buffer.findRecentSpans();

        // the sdk states both in seconds and nanoseconds, which is two numbers rather than one -
        // reading either half as the whole would be off by a factor of a thousand or by decades
        expect(recorded?.startedAt.getTime()).toBeGreaterThanOrEqual(before - 1);
        expect(recorded?.startedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1);
        expect(recorded?.durationMs).toBeGreaterThanOrEqual(0);
        expect(recorded?.durationMs).toBeLessThan(1000);
    });

    it('keeps the spans of one trace joined to each other', () => {
        const tracer: OpenTelemetryApiTracer = api.trace.getTracer('zibri-test');
        const request: OpenTelemetrySpan = tracer.startSpan('request', { kind: api.SpanKind.SERVER, root: true });
        const query: OpenTelemetrySpan = tracer.startSpan(
            'findAll Team',
            { kind: api.SpanKind.CLIENT },
            api.trace.setSpanContext(api.ROOT_CONTEXT, request.spanContext())
        );
        query.end();
        request.end();

        const trace: TraceSpanRecord[] = buffer.findSpansOfTrace(request.spanContext().traceId);

        // what makes the buffer worth reading: the query is under the request that made it, so what
        // the request spent its time on can be read off rather than guessed from timestamps
        expect(trace.map(span => span.name)).toEqual(['findAll Team', 'request']);
        expect(trace[0]?.parentSpanId).toBe(request.spanContext().spanId);
        expect(trace[1]?.parentSpanId).toBeUndefined();
    });
});