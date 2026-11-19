import { type EncryptionString } from '../auth/encryption/encryption.utilities';
import { FsPath } from '../utilities/fs.utilities';
import { BackupDigest } from './backup-digest.model';
import { StagedFileCompression } from './staged-file-compression.type';

/**
 * A resource a restore started applying, and where what it held before is kept.
 */
export type RestoreJournalEntry = {
    /**
     * The name of the resource.
     */
    resourceName: string,
    /**
     * The snapshot of what the resource held before the restore.
     */
    snapshotPath: FsPath,
    /**
     * What the snapshot held when it was written, which it is checked against before it is put back.
     */
    snapshotDigest: BackupDigest,
    /**
     * How the snapshot is stored. Absent in a journal a release left that stored every snapshot as it was handed over.
     */
    snapshotCompression?: StagedFileCompression,
    /**
     * The key and IV the snapshot is encrypted with, encrypted by the master key. Absent for a snapshot
     * stored unencrypted.
     */
    snapshotEncryptionKey?: EncryptionString
};