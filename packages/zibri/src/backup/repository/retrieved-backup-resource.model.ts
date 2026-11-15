import { Readable } from 'node:stream';

/**
 * The data of a resource of a deduplicated backup, as a transport hands it back to be restored.
 */
export type RetrievedBackupResource = {
    /**
     * Stored in one piece: the data as the transports of format 1 store it, encrypted with the key the
     * backup recorded for the resource, if any, and summed as stored.
     */
    kind: 'whole',
    /**
     * The data, as it was stored.
     */
    data: Readable
} | {
    /**
     * Stored as chunks: the data rebuilt from them, each one checked against its id as it is read.
     */
    kind: 'chunks',
    /**
     * The data of the resource, not read yet.
     */
    data: Readable,
    /**
     * How many bytes the data is, as its manifest lists the chunks.
     */
    size: number,
    /**
     * The checksum of the chunks the manifest lists, to compare against the one the backup recorded
     * before any of them is fetched.
     */
    checksum: string
};