import { beforeEach, describe, expect, it } from '@jest/globals';

import { TraceContextUtilities } from './trace-context.utilities';
import { TraceSpanContext } from './trace-span-context.model';
import { TraceSpanKind } from './trace-span-kind.enum';
import { TraceSpanStatus } from './trace-span-status.enum';
import { TraceSpanInterface } from './trace-span.interface';
import { TracingUtilities } from './tracing.utilities';
import { DiContainer } from '../di/di-container';
import { initDiContainer } from '../di/init-di-container.function';

describe('TracingUtilities', () => {

    beforeEach(() => {
        DiContainer.reset();
        initDiContainer();
    });

    describe('startSpan', () => {
        it('starts a span through the tracer the framework registers by default', () => {
            // the default tracer reaches for `@opentelemetry/api` and throws by name when it is
            // absent, so a span coming back at all is what says the peer resolved
            const span: TraceSpanInterface = TracingUtilities.startSpan('some work');

            expect(span.context.traceId).toMatch(/^[\da-f]{32}$/);
            expect(span.context.spanId).toMatch(/^[\da-f]{16}$/);
        });

        it('gives a span a trace even when no sdk is recording', () => {
            // with nothing registered the api answers with a context of all zeroes, which is its
            // way of saying the span is not real. The trace still is - it is what every log line of
            // this work reports and what the next service continues
            const span: TraceSpanInterface = TracingUtilities.startSpan('some work');

            expect(span.context.traceId).not.toMatch(/^0+$/);
            expect(span.context.spanId).not.toMatch(/^0+$/);
        });

        it('gives two spans started apart two traces', () => {
            expect(TracingUtilities.startSpan('one').context.traceId)
                .not.toBe(TracingUtilities.startSpan('other').context.traceId);
        });

        it('continues the trace of a parent it was handed', () => {
            const parent: TraceSpanContext = {
                traceId: TraceContextUtilities.generateTraceId(),
                spanId: TraceContextUtilities.generateSpanId(),
                sampled: true
            };

            const span: TraceSpanInterface = TracingUtilities.startSpan('answering', {
                kind: TraceSpanKind.SERVER,
                parent
            });

            expect(span.context.traceId).toBe(parent.traceId);
            expect(span.context.spanId).not.toBe(parent.spanId);
        });
    });

    describe('trace', () => {
        it('returns what the function returned', async () => {
            expect(await TracingUtilities.trace('work', {}, () => Promise.resolve('the answer'))).toBe('the answer');
        });

        it('makes the span the current one for the length of the function', async () => {
            expect(TracingUtilities.getCurrentSpan()).toBeUndefined();

            const seen: TraceSpanInterface | undefined = await TracingUtilities.trace(
                'work',
                {},
                () => Promise.resolve(TracingUtilities.getCurrentSpan())
            );

            expect(seen).toBeDefined();
            expect(TracingUtilities.getCurrentSpan()).toBeUndefined();
        });

        it('carries the trace across an await', async () => {
            const [inside, after]: (TraceSpanContext | undefined)[] = await TracingUtilities.trace(
                'work',
                {},
                async () => {
                    const before: TraceSpanContext | undefined = TracingUtilities.getCurrentTraceContext();
                    await Promise.resolve();
                    return [before, TracingUtilities.getCurrentTraceContext()];
                }
            );

            expect(inside).toBeDefined();
            expect(after).toEqual(inside);
        });

        it('hangs nested work under the work that contains it', async () => {
            const [outer, inner]: (TraceSpanContext | undefined)[] = await TracingUtilities.trace(
                'outer',
                {},
                async outerSpan => await TracingUtilities.trace(
                    'inner',
                    {},
                    innerSpan => Promise.resolve([outerSpan.context, innerSpan.context])
                )
            );

            expect(inner?.traceId).toBe(outer?.traceId);
            expect(inner?.spanId).not.toBe(outer?.spanId);
        });

        it('starts a new trace for work that says it is a root', async () => {
            const [outer, inner]: (TraceSpanContext | undefined)[] = await TracingUtilities.trace(
                'outer',
                {},
                async outerSpan => await TracingUtilities.trace(
                    'scheduled',
                    { root: true },
                    innerSpan => Promise.resolve([outerSpan.context, innerSpan.context])
                )
            );

            // a cron tick that fired while a request happened to be in flight is not part of that
            // request, and a trace claiming otherwise makes one request look responsible for
            // everything the schedule did
            expect(inner?.traceId).not.toBe(outer?.traceId);
        });

        it('rethrows what the function threw', async () => {
            await expect(TracingUtilities.trace('work', {}, async () => {
                // after an await rather than before, which is the shape that matters: a span has to
                // end for work that failed partway, not only for work that refused to start
                await Promise.resolve();
                throw new Error('it broke');
            })).rejects.toThrow('it broke');
        });

        it('leaves nothing current after the function threw', async () => {
            await expect(TracingUtilities.trace('work', {}, async () => {
                await Promise.resolve();
                throw new Error('it broke');
            })).rejects.toThrow();

            expect(TracingUtilities.getCurrentSpan()).toBeUndefined();
        });
    });

    describe('SpanInterface', () => {
        it('ignores a span being ended twice', () => {
            const span: TraceSpanInterface = TracingUtilities.startSpan('work');

            span.end();
            // a span ended in a finally and again on the way out of a branch is a mistake in the
            // code being traced, and it must not take down the work being traced
            expect(() => span.end(TraceSpanStatus.ERROR)).not.toThrow();
        });

        it('takes an attribute, a set of them, an error and a rename without complaint', () => {
            const span: TraceSpanInterface = TracingUtilities.startSpan('work');

            expect(() => {
                span.updateName('GET /things/:id');
                span.recordAttribute('http.route', '/things/:id');
                span.recordAttribute('http.response.status_code', undefined);
                span.recordAttributes({ 'db.system': 'postgresql', 'db.response.returned_rows': 3 });
                span.recordError(new Error('it broke'));
                span.recordError('a thrown string');
                span.end(TraceSpanStatus.ERROR);
            }).not.toThrow();
        });
    });
});