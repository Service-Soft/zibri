import { describe, expect, it } from '@jest/globals';

import { InMemoryTraceBuffer } from './in-memory.trace-buffer';
import { TraceSpanKind } from './trace-span-kind.enum';
import { TraceSpanRecord } from './trace-span-record.model';
import { TraceSpanStatus } from './trace-span-status.enum';

/**
 * A finished span, of the trace and under the name given.
 * @param name - What the work is called.
 * @param traceId - The trace it belongs to.
 * @returns The record a buffer would be handed.
 */
function spanRecord(name: string, traceId: string = 'a'.repeat(32)): TraceSpanRecord {
    return {
        traceId,
        spanId: name.padStart(16, '0'),
        parentSpanId: undefined,
        name,
        kind: TraceSpanKind.INTERNAL,
        startedAt: new Date('2026-09-20T10:00:00.000Z'),
        durationMs: 1.5,
        status: TraceSpanStatus.UNSET,
        statusMessage: undefined,
        attributes: { 'code.function': name }
    };
}

/**
 * The names a buffer holds, in the order it answers with.
 * @param spans - What it answered.
 * @returns The names alone, which is what each case is about.
 */
function namesOf(spans: TraceSpanRecord[]): string[] {
    return spans.map(span => span.name);
}

describe('InMemoryTraceBuffer', () => {

    it('answers with what it holds, newest first', () => {
        const buffer: InMemoryTraceBuffer = new InMemoryTraceBuffer(5);
        buffer.record(spanRecord('first'));
        buffer.record(spanRecord('second'));

        // newest first because the question a buffer answers is what just happened, and an answer
        // that starts at the oldest thing it still holds makes that the last thing read
        expect(namesOf(buffer.findRecentSpans())).toEqual(['second', 'first']);
    });

    it('holds nothing before anything was recorded', () => {
        expect(new InMemoryTraceBuffer(5).findRecentSpans()).toEqual([]);
    });

    it('drops the oldest span rather than growing', () => {
        const buffer: InMemoryTraceBuffer = new InMemoryTraceBuffer(3);
        for (const name of ['one', 'two', 'three', 'four', 'five']) {
            buffer.record(spanRecord(name));
        }

        // what makes the buffer safe to leave on: a process that has answered a million requests
        // holds the same three spans a process that has answered four does
        expect(namesOf(buffer.findRecentSpans())).toEqual(['five', 'four', 'three']);
    });

    it('keeps answering in order after it has wrapped several times', () => {
        const buffer: InMemoryTraceBuffer = new InMemoryTraceBuffer(4);
        for (let i: number = 0; i < 30; i++) {
            buffer.record(spanRecord(`span-${i}`));
        }

        // the ring is walked from where the next write would go, and an index that ran the wrong way
        // round would answer correctly on the first lap and wrongly on every one after it
        expect(namesOf(buffer.findRecentSpans())).toEqual(['span-29', 'span-28', 'span-27', 'span-26']);
    });

    it('answers with no more than it was asked for', () => {
        const buffer: InMemoryTraceBuffer = new InMemoryTraceBuffer(10);
        for (const name of ['one', 'two', 'three']) {
            buffer.record(spanRecord(name));
        }

        expect(namesOf(buffer.findRecentSpans(2))).toEqual(['three', 'two']);
    });

    it('finds what it still holds of one trace, in the order the work happened', () => {
        const buffer: InMemoryTraceBuffer = new InMemoryTraceBuffer(10);
        buffer.record(spanRecord('request', 'b'.repeat(32)));
        buffer.record(spanRecord('elsewhere', 'c'.repeat(32)));
        buffer.record(spanRecord('query', 'b'.repeat(32)));

        // oldest first here, the opposite of the recent list: a trace is read as a story, and a story
        // told backwards has the outcome before the work
        expect(namesOf(buffer.findSpansOfTrace('b'.repeat(32)))).toEqual(['request', 'query']);
    });

    it('answers nothing for a trace it never held', () => {
        const buffer: InMemoryTraceBuffer = new InMemoryTraceBuffer(10);
        buffer.record(spanRecord('request', 'b'.repeat(32)));

        expect(buffer.findSpansOfTrace('d'.repeat(32))).toEqual([]);
    });

    it('holds nothing again once it is cleared, and keeps its order afterwards', () => {
        const buffer: InMemoryTraceBuffer = new InMemoryTraceBuffer(3);
        buffer.record(spanRecord('before'));
        buffer.clear();

        expect(buffer.findRecentSpans()).toEqual([]);

        // clearing rewinds where the next span goes as well as what is held, so a stale slot cannot
        // reappear once the ring passes it again
        buffer.record(spanRecord('after'));
        expect(namesOf(buffer.findRecentSpans())).toEqual(['after']);
    });

    it('refuses a size that holds nothing', () => {
        // a buffer of zero would accept every span and answer with none of them, which reads as
        // tracing being broken rather than as a buffer being switched off
        expect(() => new InMemoryTraceBuffer(0)).toThrow('at least one');
        expect(() => new InMemoryTraceBuffer(2.5)).toThrow('whole number');
    });
});