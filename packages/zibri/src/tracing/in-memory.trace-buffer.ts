import { TraceBufferInterface } from './trace-buffer.interface';
import { TraceSpanRecord } from './trace-span-record.model';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * How many spans are kept when nothing says otherwise.
 *
 * A number of spans rather than of requests, because a request is however many spans its work turned
 * out to be. At the handful a plain request produces, this is a few hundred of them, and what it
 * costs is under a megabyte.
 */
const defaultTraceBufferSize: number = 1000;

/**
 * Keeps the most recent spans in this process, and nowhere else.
 *
 * A ring rather than a list that is trimmed: the oldest entry is overwritten in place, so recording
 * a span costs the same whether the buffer is empty or full and nothing is copied on the path of the
 * work being recorded.
 *
 * What it holds is a window rather than a history. At a few spans per request, a thousand of them is
 * a few hundred requests - seconds of a busy service, minutes of a quiet one - so it answers what is
 * happening now. Anything that has to survive being asked about tomorrow belongs with an exporter.
 */
export class InMemoryTraceBuffer implements TraceBufferInterface {
    /**
     * The ring. Sparse until it has been filled once, which is why reading skips what is not there.
     */
    private readonly spans: (TraceSpanRecord | undefined)[];

    /**
     * Where the next span goes, which is also the oldest one once the ring has wrapped.
     */
    private next: number = 0;

    constructor(readonly size: number = defaultTraceBufferSize) {
        if (!Number.isInteger(size) || size <= 0) {
            throw new InternalError(`A trace buffer holds a whole number of spans, at least one. Got ${size}.`);
        }
        this.spans = Array.from({ length: size });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    record(span: TraceSpanRecord): void {
        this.spans[this.next] = span;
        this.next = (this.next + 1) % this.size;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    findRecentSpans(limit: number = this.size): TraceSpanRecord[] {
        const found: TraceSpanRecord[] = [];
        // backwards from the most recently written slot, so reading stops as soon as enough has been
        // found rather than walking the whole ring to sort it afterwards
        for (let i: number = 1; i <= this.size && found.length < limit; i++) {
            const span: TraceSpanRecord | undefined = this.spans[(this.next - i + this.size) % this.size];
            if (span != undefined) {
                found.push(span);
            }
        }
        return found;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    findSpansOfTrace(traceId: string): TraceSpanRecord[] {
        return this.findRecentSpans().filter(span => span.traceId === traceId)
            .reverse();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    clear(): void {
        this.spans.fill(undefined);
        this.next = 0;
    }
}