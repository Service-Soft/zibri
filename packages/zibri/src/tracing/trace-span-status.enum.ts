/**
 * How a span ended.
 */
export enum TraceSpanStatus {
    /**
     * Nothing was said about it, which is what most spans should report.
     *
     * The default, and different from `OK`: a span that finished without anybody deciding it went
     * well leaves the judgement to whoever reads the trace, and a backend can still color it by the
     * attributes it carries. `OK` is a claim, and claiming it everywhere makes the word useless.
     */
    UNSET = 'unset',
    /**
     * The work finished and somebody decided that counts as success.
     */
    OK = 'ok',
    /**
     * The work failed.
     */
    ERROR = 'error'
}