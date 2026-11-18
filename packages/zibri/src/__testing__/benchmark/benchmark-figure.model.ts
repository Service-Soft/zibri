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
    unit: BenchmarkUnit,
    /**
     * How much more than on the release the value may be, in `unit`, before the comparison with the release
     * looks at how many times as much it is: what the same code differs by from one run to the next. Without
     * one, memory is held to the slack of the comparison, and anything else to none.
     */
    slack?: number
};