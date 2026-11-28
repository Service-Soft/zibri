import { Readable } from 'node:stream';

/**
 * A session with a backup transport of `v2`: what one resource of a backup or a restore does on it runs on one
 * session, which the caller closes once it is done.
 *
 * A key is a path of `/`-separated segments, relative to wherever the transport keeps what its keys hold, such as
 * a folder or the prefix in a bucket.
 */
export interface BackupTransportSessionInterface {
    /**
     * Stores data under a key, replacing what the key held. Whole or not at all: no reader sees part
     * of it, and a put that fails leaves the key as it was.
     * @param key - The key.
     * @param data - The data, read to its end.
     */
    put: (key: string, data: Readable) => Promise<void>,
    /**
     * Reads what a key holds. The stream is read to its end, or destroyed, before the session is closed.
     * @param key - The key.
     * @param maxBytes - The most the key may hold. A larger one is refused, before any of it is read
     * where the store can tell its size up front.
     * @returns The data.
     * @throws BackupKeyNotFoundError when the key holds nothing.
     * @throws BackupKeyAccessDeniedError when the transport may not read it, here or from the stream.
     */
    get: (key: string, maxBytes: number) => Promise<Readable>,
    /**
     * Finds every key that starts with a prefix, a page at a time, in no particular order. A put still
     * running is not among them.
     * @param prefix - The prefix, `''` for every key.
     * @returns The keys, in pages.
     */
    findKeys: (prefix: string) => AsyncIterable<string[]>,
    /**
     * Finds the names directly below a path: the next segment of every key under it, each once, a page
     * at a time, in no particular order. A store keeping folders may also name a folder that holds no
     * key.
     * @param path - The segments to look below, such as `backups/2026`, or `''` for the top.
     * @returns The names, in pages.
     */
    findNames: (path: string) => AsyncIterable<string[]>,
    /**
     * Deletes keys. A key that holds nothing is no error.
     * @param keys - The keys.
     */
    delete: (keys: string[]) => Promise<void>,
    /**
     * Deletes what puts that ended part way, such as with a process that went down, left on the transport under names
     * no listing shows, once it is old enough that no put still runs on it. Each garbage collection calls it once, while
     * no resource is being stored. A transport whose puts leave nothing behind, or that removes it on its own, has none.
     */
    deleteAbandonedUploads?: () => Promise<void>,
    /**
     * Ends the session.
     */
    close: () => Promise<void>
}