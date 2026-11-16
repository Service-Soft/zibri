import { Readable } from 'node:stream';

/**
 * What a resource that reads only what changed hands a backup.
 */
export type IncrementalBackupData = {
    /**
     * The data: of the resource in full, or of what changed since the cursor it was handed.
     */
    data: Readable,
    /**
     * Whether `data` holds the resource in full, which it does when it was handed no cursor or one it
     * cannot read on from.
     */
    full: boolean,
    /**
     * Where the next backup reads on from, once this one completed.
     */
    cursor: string
};