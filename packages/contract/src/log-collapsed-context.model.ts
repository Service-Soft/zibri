/**
 * How often a log was written again within a short time, which the server keeps as one log.
 */
export type LogCollapsedContext = {
    /**
     * How often it was written.
     */
    count: number,
    /**
     * When it was written the last time, as an ISO string.
     */
    lastAt: string
};