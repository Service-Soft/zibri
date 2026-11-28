import { Readable } from 'node:stream';

import { StorageEntry } from './storage-entry.model';

/**
 * A session with a store keeping blobs under keys: a folder, a bucket or an SFTP server. What backup transports and
 * file stores both stand on.
 *
 * A key is a path of `/`-separated segments, relative to wherever the store keeps its blobs. The errors name the store
 * as its `StorageNaming` says.
 */
export interface StorageSessionInterface {
    /**
     * Stores data under a key, replacing what the key held. Whole or not at all: no reader sees part of it, and a put
     * that fails leaves the key as it was.
     * @param key - The key.
     * @param data - The data, read to its end.
     */
    put: (key: string, data: Readable) => Promise<void>,
    /**
     * Reads what a key holds. The stream is read to its end, or destroyed, before the session is closed.
     * @param key - The key.
     * @param maxBytes - The most the key may hold. A larger one is refused, before any of it is read where the store
     * can tell its size up front.
     * @returns The data.
     */
    get: (key: string, maxBytes: number) => Promise<Readable>,
    /**
     * Finds what a key holds, without reading it.
     * @param key - The key.
     * @returns Its size and when it was written, or undefined when the key holds nothing.
     */
    findEntry: (key: string) => Promise<StorageEntry | undefined>,
    /**
     * Finds every key that starts with a prefix, a page at a time, in no particular order. A put still running is not
     * among them.
     * @param prefix - The prefix, `''` for every key.
     * @returns The keys, in pages.
     */
    findKeys: (prefix: string) => AsyncIterable<string[]>,
    /**
     * Finds the names directly below a path: the next segment of every key under it, each once, a page at a time, in
     * no particular order. A store keeping folders may also name a folder that holds no key.
     * @param path - The segments to look below, or `''` for the top.
     * @returns The names, in pages.
     */
    findNames: (path: string) => AsyncIterable<string[]>,
    /**
     * Deletes keys. A key that holds nothing is no error.
     * @param keys - The keys.
     */
    delete: (keys: string[]) => Promise<void>,
    /**
     * Ends the session.
     */
    close: () => Promise<void>
}