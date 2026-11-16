import { FsPath } from '../utilities/fs.utilities';

/**
 * What restoring one resource of a backup takes on this instance's disk.
 */
export type RestoreSpaceOfResource = {
    /**
     * The name of the resource.
     */
    name: string,
    /**
     * What fetching its data takes.
     */
    fetchedBytes: number,
    /**
     * What the copy of what it holds now takes, which a failed restore puts back. 0 when none is kept.
     */
    snapshotBytes: number,
    /**
     * Whether the sizes are those of the data uncompressed, of a backup that recorded no size as staged, which
     * are the most it takes.
     */
    atMost: boolean
};

/**
 * What restoring a backup takes on this instance's disk, and what the disk has free.
 */
export type RestoreSpace = {
    /**
     * The name of the backup.
     */
    backupName: string,
    /**
     * The folder the restore stages in, `ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER`.
     */
    folder: FsPath,
    /**
     * What the disk of the folder has free.
     */
    freeBytes: number,
    /**
     * What each resource takes.
     */
    resources: RestoreSpaceOfResource[]
};