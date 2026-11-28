import { type FileMirrorSource } from './file-mirror-source.model';

/**
 * A file to mirror into a folder of a WebDAV server, as `mirrorFile` of the file mirror service takes it.
 */
export type FileToMirror = {
    /**
     * The id of the `TenantWebDavConnection` of the active tenant the folder is reached through.
     */
    connectionId: string,
    /**
     * Where the file goes, relative to the url of the connection, its segments separated by `/`, such as
     * `Customers/Ada Lovelace/Invoices/2026-001.pdf`. The folders it is in are created where they are missing.
     */
    path: string,
    /**
     * What the file holds: text, written as utf-8, or bytes. At most 50 MB.
     */
    content: string | Uint8Array,
    /**
     * The media type it is stored as, such as `application/pdf`.
     */
    contentType: string,
    /**
     * What the file is of, such as the invoice it is the pdf of.
     */
    source: FileMirrorSource
};
