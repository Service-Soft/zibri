import { type MirroredFileConflict } from './mirrored-file-conflict.enum';

/**
 * A file mirrored into a folder of a WebDAV server, as the routes of the file mirror answer it: where it was mirrored
 * to, where it is now, the version written last, and the conflict that keeps it from being written, if any.
 */
export type MirroredFileModel = {
    /**
     * The id of the mirrored file.
     */
    id: string,
    /**
     * The tenant it belongs to.
     */
    tenantId: string,
    /**
     * The kind of row the file is of, such as `invoice`.
     */
    sourceType: string,
    /**
     * The id of the row.
     */
    sourceId: string,
    /**
     * The id of the WebDAV connection of the tenant the folder is reached through.
     */
    connectionId: string,
    /**
     * Where the file is mirrored to, relative to the url of the connection, such as
     * `Customers/Ada Lovelace/Invoices/2026-001.pdf`.
     */
    path: string,
    /**
     * Where the file is now, relative to the url of the connection: its `path`, or where somebody moved it to on a
     * Nextcloud.
     */
    currentPath: string,
    /**
     * The id Nextcloud keeps the file under, or null for a connection to another server.
     */
    fileId?: string | null,
    /**
     * The ETag of the version written last, or null while none was written.
     */
    etag?: string | null,
    /**
     * The SHA-256 of the content written last, in hex, or null while none was written.
     */
    contentHash?: string | null,
    /**
     * When the version written last was written, or null while none was.
     */
    mirroredAt?: Date | null,
    /**
     * Why the last version mirrored was not written, or null when it was.
     */
    conflict?: MirroredFileConflict | null,
    /**
     * When the conflict was found, or null without one.
     */
    conflictAt?: Date | null
};