/**
 * What a {@link BenchmarkFigure} is counted in.
 */
export type BenchmarkUnit = 'ms' | 'bytes';

/**
 * One measured figure other than a timing of many runs, such as the peak memory of an operation or
 * the CPU time it spent. Lower is better, as with a timing.
 */
export type BenchmarkFigure = {
    /**
     * What was measured.
     */
    name: string,
    /**
     * The measured value, in `unit`.
     */
    value: number,
    /**
     * What `value` is counted in.
     */
    unit: BenchmarkUnit
};