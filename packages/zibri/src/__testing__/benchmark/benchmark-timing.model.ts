/**
 * How long one measured operation took, over many runs of it.
 */
export type BenchmarkTiming = {
    /**
     * What was measured.
     */
    name: string,
    /**
     * The middle run, in milliseconds - what the operation usually takes.
     */
    medianMs: number,
    /**
     * The run that 95 in 100 were faster than, in milliseconds - how slow the slow ones are.
     */
    p95Ms: number
};