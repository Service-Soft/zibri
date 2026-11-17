/**
 * How the chunks of the backups are read back from the transports and checked, which finds a chunk that
 * changed where it is stored.
 */
export type BackupScrubOptions = {
    /**
     * In how many days every chunk is read once. Each daily garbage collection reads that share of the
     * chunks the backups name. From 1 to 256.
     */
    cycleInDays: number
};