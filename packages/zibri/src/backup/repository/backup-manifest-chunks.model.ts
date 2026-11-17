import { BackupManifestEntry } from './backup-manifest-entry.model';
import { BackupRepositoryKey } from './backup-repository-key.model';

/**
 * The chunks the manifest of a resource names, and the key they are encrypted with.
 */
export type BackupManifestChunks = {
    /**
     * The repository key the chunks are encrypted with, or undefined for unencrypted ones.
     */
    key: BackupRepositoryKey | undefined,
    /**
     * The chunks, in order.
     */
    entries: BackupManifestEntry[]
};