/**
 * How much a sort of names on the instance's own disk holds at once.
 */
export type StagedSortLimits = {
    /**
     * About how many bytes of names one run holds before it is sorted and written.
     */
    runBytes: number,
    /**
     * How many runs one merge reads at once, each a file open and a buffer held. More runs than that are
     * merged into fewer first.
     */
    maxRunsMerged: number
};