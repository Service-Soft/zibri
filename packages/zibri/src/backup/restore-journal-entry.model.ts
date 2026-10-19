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
    snapshotPath: FsPath
};