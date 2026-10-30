/**
 * A chain whose every row is as it was written.
 */
export type IntactChain = {
    /**
     * Always true.
     */
    intact: true,
    /**
     * The place of the newest row, or 0 for a chain with no rows. Keep it, and the hash, outside the
     * data source: a chain alone cannot tell that rows were removed from its newest end.
     */
    newestSequence: number,
    /**
     * The hash of the newest row, or an empty string for a chain with no rows.
     */
    newestHash: string
};

/**
 * A chain that holds a row that was changed, slipped in, or follows rows that are missing.
 */
export type BrokenChain = {
    /**
     * Always false.
     */
    intact: false,
    /**
     * The place of the first row that does not hold.
     */
    brokenAtSequence: number,
    /**
     * What is wrong there.
     */
    reason: string
};

/**
 * What checking a chain found.
 */
export type ChainVerification = IntactChain | BrokenChain;