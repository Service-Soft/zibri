/**
 * How the conflict of a mirrored file is resolved.
 */
export enum MirroredFileConflictResolution {
    /**
     * The last version mirrored replaces what is in the folder: where the file is now, or where it was mirrored to
     * when it is gone.
     */
    OVERWRITE = 'OVERWRITE',
    /**
     * The file is no longer mirrored, and stays in the folder as it is. A later version mirrored to the same path is
     * a new file, written only where nothing is.
     */
    STOP_MIRRORING = 'STOP_MIRRORING'
}
