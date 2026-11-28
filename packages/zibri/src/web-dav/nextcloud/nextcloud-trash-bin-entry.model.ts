/**
 * A file or a folder in the trash bin of a user of Nextcloud, where it is kept, and takes up the storage of the user,
 * after it was deleted.
 */
export type NextcloudTrashBinEntry = {
    /**
     * The name Nextcloud keeps it under in the trash bin, its name and the time it was deleted at, such as
     * `2026-001.pdf.d1764160000`.
     */
    readonly id: string,
    /**
     * The user whose trash bin holds it.
     */
    readonly user: string,
    /**
     * Where it was before it was deleted, relative to the url of the connection.
     */
    readonly originalPath: string,
    /**
     * Whether it is a file or a folder.
     */
    readonly kind: 'file' | 'folder',
    /**
     * How many bytes a file holds, or undefined for a folder and for a file Nextcloud names no size of.
     */
    readonly size: number | undefined,
    /**
     * When it was deleted, or undefined when Nextcloud does not say.
     */
    readonly deletedAt: Date | undefined
};
