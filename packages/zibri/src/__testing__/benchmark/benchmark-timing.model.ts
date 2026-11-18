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
    p95Ms: number,
    /**
     * How much longer than on the release the middle run may take, in milliseconds, before the comparison with the
     * release looks at how many times as long it is: for an operation run once or a few times rather than many,
     * which a moment of the machine doing something else is a part of. Without one, the ratio alone decides.
     */
    slack?: number
};