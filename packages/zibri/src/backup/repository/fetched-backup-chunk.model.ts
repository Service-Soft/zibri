import { BackupManifestEntry } from './backup-manifest-entry.model';

/**
 * A chunk a restore fetched, found to be the chunk of its id, and kept as it was stored: compressed, and encrypted
 * for an encrypted resource.
 */
export type FetchedBackupChunk = {
    /**
     * Which chunk it is, and how many bytes its data is.
     */
    entry: BackupManifestEntry,
    /**
     * Its bytes as they were stored, which `BackupChunkUtilities.open` opens.
     */
    stored: Buffer
};