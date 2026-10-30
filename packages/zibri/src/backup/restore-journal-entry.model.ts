import { BackupDigest } from './staging.function';
import { FsPath } from '../utilities/fs.utilities';

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
    snapshotDigest: BackupDigest
};