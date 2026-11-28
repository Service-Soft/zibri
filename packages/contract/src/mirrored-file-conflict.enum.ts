/**
 * Why a mirrored file was not written into its folder, which somebody resolves in the folder, or through the routes of
 * the file mirror.
 */
export enum MirroredFileConflict {
    /**
     * Somebody changed the file in the folder since it was mirrored, or wrote another one where it is mirrored to
     * first.
     */
    CHANGED = 'CHANGED',
    /**
     * The file is no longer where it was mirrored to: somebody moved, renamed or deleted it. A file a connection to a
     * Nextcloud mirrored is followed where it was moved or renamed to, and missing once it is deleted or out of the
     * folder of the connection.
     */
    MISSING = 'MISSING'
}
