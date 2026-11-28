import { Readable } from 'node:stream';

import { FileStoreEntry } from './file-store-entry.model';

/**
 * Where the bytes of files are kept, such as a folder, a bucket or an SFTP server: bytes under keys, and nothing of
 * what a file is.
 *
 * A key is a path of `/`-separated segments, none of them empty, `.` or `..`, relative to wherever the store keeps
 * its bytes. The `FileService` decides the keys.
 */
export interface FileStoreInterface {
    /**
     * The name of the store, which the files kept in it record. Changing it loses the way to them.
     */
    readonly name: string,
    /**
     * Stores bytes under a key, replacing what the key held. Whole or not at all: no reader sees part of them, and a
     * put that fails leaves the key as it was.
     * @param key - The key.
     * @param data - The bytes, read to their end.
     */
    put: (key: string, data: Readable) => Promise<void>,
    /**
     * Reads what a key holds, as a stream, which is read to its end or destroyed.
     * @param key - The key.
     * @param maxBytes - The most the key may hold. A larger one is refused, before any of it is read where the store
     * can tell its size up front.
     * @returns The bytes.
     * @throws FileStoreKeyNotFoundError when the key holds nothing.
     */
    get: (key: string, maxBytes: number) => Promise<Readable>,
    /**
     * Finds what a key holds, without reading it.
     * @param key - The key.
     * @returns Its size and when it was written, or undefined when the key holds nothing.
     */
    findEntry: (key: string) => Promise<FileStoreEntry | undefined>,
    /**
     * Finds every key that starts with a prefix, a page at a time, in no particular order. A put still running is not
     * among them.
     * @param prefix - The prefix, `''` for every key.
     * @returns The keys, in pages.
     */
    findKeys: (prefix: string) => AsyncIterable<string[]>,
    /**
     * Deletes keys. A key that holds nothing is no error.
     * @param keys - The keys.
     */
    delete: (keys: string[]) => Promise<void>
}

/**
 * The members every file store has.
 */
const FILE_STORE_MEMBERS: (keyof FileStoreInterface)[] = ['name', 'put', 'get', 'findEntry', 'findKeys', 'delete'];

/**
 * Checks whether or not the given value is a file store.
 * @param value - The value to check.
 * @returns True if the value has every member of `FileStoreInterface`.
 */
export function isFileStore(value: unknown): value is FileStoreInterface {
    return typeof value === 'object' && value != undefined && FILE_STORE_MEMBERS.every(member => member in value);
}