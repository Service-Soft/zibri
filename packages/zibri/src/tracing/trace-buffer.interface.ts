import { TraceSpanRecord } from './trace-span-record.model.ts';

/**
 * Keeps the spans the application recorded most recently, so that they can be read back.
 *
 * What a trace is worth reading for is what happened just now: which route was slow, what it asked
 * the data source for, and which call it was waiting on. That question is asked while it is still
 * true, which is what a bounded buffer answers - the oldest span is dropped to make room for the
 * newest, so what is held costs a fixed amount of memory no matter how long the process runs.
 *
 * It holds spans rather than whole traces, so a trace at the far end of the buffer can be there in
 * part. Reading one back is therefore reading what is still held of it.
 */
export interface TraceBufferInterface {
    /**
     * How many spans it holds before the oldest is dropped.
     */
    readonly size: number,
    /**
     * Takes a finished span.
     *
     * Called for every span the application records, so it runs on the path of the work being
     * recorded and does nothing that can fail.
     */
    record: (span: TraceSpanRecord) => void,
    /**
     * The spans it holds, newest first.
     */
    findRecentSpans: (limit?: number) => TraceSpanRecord[],
    /**
     * What it still holds of one trace, oldest first, which is the order the work happened in.
     */
    findSpansOfTrace: (traceId: string) => TraceSpanRecord[],
    /**
     * Drops everything it holds.
     */
    clear: () => void
}