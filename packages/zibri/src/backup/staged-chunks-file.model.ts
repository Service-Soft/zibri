import { FsPath } from '../utilities/fs.utilities';
import { BackupRepositoryKey } from './repository/backup-repository-key.model';

/**
 * A file a restore stages the chunks of a resource in, as they were stored: compressed already, and encrypted with
 * the repository key for an encrypted resource. Read back as the resource's data.
 */
export type StagedChunksFile = {
    /**
     * Where it is.
     */
    path: FsPath,
    /**
     * That it holds chunks.
     */
    compression: 'chunks',
    /**
     * The repository key the chunks are opened with, or undefined for unencrypted chunks.
     */
    key: BackupRepositoryKey | undefined,
    /**
     * How many bytes the data of all its chunks is, as the manifest lists them: a file cut short between two chunks
     * holds chunks that are each whole.
     */
    size: number,
    /**
     * The checksum of its chunks in order, as the manifest lists them: chunks that changed places in the file are
     * each whole, and of the same size together.
     */
    checksum: string
};