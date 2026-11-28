import { Readable } from 'node:stream';

/**
 * A file read from a WebDAV server.
 */
export type WebDavDownload = {
    /**
     * The bytes of the file, to read to their end or destroy.
     */
    content: Readable,
    /**
     * The ETag of what was read, quotes included, or undefined when the server names none.
     */
    etag: string | undefined
};