/**
 * How a cron job that keeps failing skips slots.
 */
export type CronBackOffOptions = {
    /**
     * The most slots skipped after a failure. After n failures in a row the job skips 2^n - 1 slots,
     * 1, then 3, then 7, up to this many.
     */
    maxSkippedSlots: number
};