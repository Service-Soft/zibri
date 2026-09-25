import { describe, expect, it } from '@jest/globals';

import { TraceContextUtilities } from './trace-context.utilities';
import { TraceSpanContext } from './trace-span-context.model';

const traceId: string = '4bf92f3577b34da6a3ce929d0e0e4736';
const spanId: string = '00f067aa0ba902b7';
const sampled: string = `00-${traceId}-${spanId}-01`;

describe('TraceContextUtilities', () => {
    describe('findSpanContext', () => {
        it('reads the trace id and the span id out of a traceparent', () => {
            expect(TraceContextUtilities.findSpanContext({ traceparent: sampled })).toEqual({
                traceId,
                spanId,
                sampled: true
            });
        });

        it('reads the sampled flag off the last byte', () => {
            expect(TraceContextUtilities.findSpanContext({ traceparent: `00-${traceId}-${spanId}-00` })?.sampled).toBe(false);
            // only the lowest bit is defined, so anything with it set is sampled and anything
            // without it is not, whatever the rest of the byte says
            expect(TraceContextUtilities.findSpanContext({ traceparent: `00-${traceId}-${spanId}-03` })?.sampled).toBe(true);
            expect(TraceContextUtilities.findSpanContext({ traceparent: `00-${traceId}-${spanId}-02` })?.sampled).toBe(false);
        });

        it('finds nothing when no traceparent arrived', () => {
            expect(TraceContextUtilities.findSpanContext({})).toBeUndefined();
            expect(TraceContextUtilities.findSpanContext({ traceparent: '' })).toBeUndefined();
        });

        it('takes the first value when the header arrived more than once', () => {
            const second: string = '00-00000000000000000000000000000002-0000000000000002-01';
            expect(TraceContextUtilities.findSpanContext({ traceparent: [sampled, second] })?.traceId).toBe(traceId);
        });

        it('refuses an all zero trace id or span id', () => {
            expect(TraceContextUtilities.findSpanContext({ traceparent: `00-${'0'.repeat(32)}-${spanId}-01` })).toBeUndefined();
            expect(TraceContextUtilities.findSpanContext({ traceparent: `00-${traceId}-${'0'.repeat(16)}-01` })).toBeUndefined();
        });

        it('refuses a malformed traceparent', () => {
            expect(TraceContextUtilities.findSpanContext({ traceparent: 'not a traceparent' })).toBeUndefined();
            // too short, too long, not hex
            expect(TraceContextUtilities.findSpanContext({ traceparent: `00-${traceId.slice(1)}-${spanId}-01` })).toBeUndefined();
            expect(TraceContextUtilities.findSpanContext({ traceparent: `00-${traceId}0-${spanId}-01` })).toBeUndefined();
            expect(TraceContextUtilities.findSpanContext({ traceparent: `00-${'z'.repeat(32)}-${spanId}-01` })).toBeUndefined();
            expect(TraceContextUtilities.findSpanContext({ traceparent: `00-${traceId}-${spanId}` })).toBeUndefined();
        });

        it('refuses hex that is not lowercase', () => {
            const upper: string = `00-${traceId.toUpperCase()}-${spanId}-01`;
            expect(TraceContextUtilities.findSpanContext({ traceparent: upper })).toBeUndefined();
        });

        it('refuses the forbidden ff version', () => {
            expect(TraceContextUtilities.findSpanContext({ traceparent: `ff-${traceId}-${spanId}-01` })).toBeUndefined();
        });

        it('reads a version it does not know by its first four fields', () => {
            // a later version may append fields, and the two that matter keep their place. Refusing
            // what we cannot fully read would make this application the one that breaks the trace
            const future: string = `01-${traceId}-${spanId}-01-something-else`;
            expect(TraceContextUtilities.findSpanContext({ traceparent: future })).toEqual({ traceId, spanId, sampled: true });
        });

        it('refuses trailing data on the version it does know', () => {
            expect(TraceContextUtilities.findSpanContext({ traceparent: `00-${traceId}-${spanId}-01-extra` })).toBeUndefined();
        });

        it('carries a tracestate through untouched', () => {
            const traceState: string = 'vendor=00f067aa0ba902b7,other=t61rcWkgMzE';
            expect(TraceContextUtilities.findSpanContext({ traceparent: sampled, tracestate: traceState })?.traceState)
                .toBe(traceState);
        });

        it('drops a malformed tracestate but keeps the traceparent', () => {
            const found: TraceSpanContext | undefined = TraceContextUtilities.findSpanContext({
                traceparent: sampled,
                tracestate: 'this is not a list of pairs'
            });
            expect(found?.traceId).toBe(traceId);
            expect(found?.traceState).toBeUndefined();
        });

        it('drops a tracestate with more members than the standard allows', () => {
            const tooMany: string = Array.from({ length: 33 }, (_, i) => `key${i}=value`).join(',');
            expect(TraceContextUtilities.findSpanContext({ traceparent: sampled, tracestate: tooMany })?.traceState).toBeUndefined();
        });
    });

    describe('resolveHeaders', () => {
        it('writes a context back into the headers it came from', () => {
            const context: TraceSpanContext = { traceId, spanId, sampled: true };
            expect(TraceContextUtilities.resolveHeaders(context)).toEqual({ traceparent: sampled });
        });

        it('writes the unsampled flag as its own byte', () => {
            const context: TraceSpanContext = { traceId, spanId, sampled: false };
            expect(TraceContextUtilities.resolveTraceparent(context)).toBe(`00-${traceId}-${spanId}-00`);
        });

        it('writes the tracestate beside it when there is one', () => {
            const context: TraceSpanContext = { traceId, spanId, sampled: true, traceState: 'vendor=1' };
            expect(TraceContextUtilities.resolveHeaders(context)).toEqual({ traceparent: sampled, tracestate: 'vendor=1' });
        });

        it('round trips a context through the headers', () => {
            const context: TraceSpanContext = { traceId, spanId, sampled: true, traceState: 'vendor=1' };
            expect(TraceContextUtilities.findSpanContext(TraceContextUtilities.resolveHeaders(context))).toEqual(context);
        });
    });

    describe('generateTraceId / generateSpanId', () => {
        it('generates ids of the length and alphabet the standard asks for', () => {
            expect(TraceContextUtilities.generateTraceId()).toMatch(/^[\da-f]{32}$/);
            expect(TraceContextUtilities.generateSpanId()).toMatch(/^[\da-f]{16}$/);
        });

        it('generates a different id every time', () => {
            const ids: Set<string> = new Set(Array.from({ length: 100 }, () => TraceContextUtilities.generateTraceId()));
            expect(ids.size).toBe(100);
        });

        it('keeps generating different ids long past the point where it has to draw again', () => {
            // ids are cut from a block of random bytes drawn in one go, because drawing per id costs
            // more than recording the span does. This asks for far more than one block holds, which
            // is where handing out the same bytes twice - or the same bytes every block - would show
            const count: number = 5000;
            const traceIds: Set<string> = new Set<string>();
            const spanIds: Set<string> = new Set<string>();

            for (let i: number = 0; i < count; i++) {
                traceIds.add(TraceContextUtilities.generateTraceId());
                spanIds.add(TraceContextUtilities.generateSpanId());
            }

            expect({ traceIds: traceIds.size, spanIds: spanIds.size }).toEqual({ traceIds: count, spanIds: count });
        });

        it('hands out every id in the length and alphabet the standard asks for, not only the first', () => {
            // the block is walked with an offset, and an offset that ran past the end would produce a
            // short id rather than a wrong one - which a single call could never show
            const shortIds: string[] = Array.from({ length: 5000 }, () => TraceContextUtilities.generateSpanId())
                .filter(id => !/^[\da-f]{16}$/.test(id));

            expect(shortIds).toEqual([]);
        });

        it('generates ids the parser accepts', () => {
            const context: TraceSpanContext = {
                traceId: TraceContextUtilities.generateTraceId(),
                spanId: TraceContextUtilities.generateSpanId(),
                sampled: true
            };
            expect(TraceContextUtilities.findSpanContext(TraceContextUtilities.resolveHeaders(context))).toEqual(context);
        });
    });
});