/**
 * A chunk a transport took, to be recorded in the chunk index.
 */
export type StoredBackupChunk = {
    /**
     * The key it is stored under.
     */
    key: string,
    /**
     * How many bytes it takes there.
     */
    storedBytes: number
};