import { Readable } from 'node:stream';

import { BackupRepositoryKey } from './backup-repository-key.model';

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
     * Stored as chunks: each one checked against its id as it is fetched, and handed on as stored.
     */
    kind: 'chunks',
    /**
     * The chunks, each a `FetchedBackupChunk`, in the order of the data, not fetched yet. `BackupChunkUtilities.openAll`
     * turns them into the data.
     */
    chunks: Readable,
    /**
     * The repository key the chunks are opened with, or undefined for unencrypted chunks.
     */
    key: BackupRepositoryKey | undefined,
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