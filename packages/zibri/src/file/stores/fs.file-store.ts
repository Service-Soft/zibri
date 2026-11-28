import { Readable } from 'node:stream';

import { FsStorageSession } from '../../storage/fs.storage-session';
import { FsPath } from '../../utilities/fs.utilities';
import { FileStoreEntry } from './file-store-entry.model';
import { FileStoreInterface } from './file-store.interface';
import { resolveFileStorageNaming } from './resolve-file-storage-naming.function';

/**
 * A file store that keeps the bytes in a folder of this instance's own disk: each key a file, its segments the
 * folders leading to it. A put is on the disk once it returns.
 */
export class FsFileStore implements FileStoreInterface {
    // a folder is kept the same way a backup transport keeps one, so the session is the one both stand on. It holds
    // nothing open, so one serves every call
    private readonly session: FsStorageSession;

    /**
     * Creates the store keeping the bytes in the given folder.
     * @param name - The name of the store.
     * @param folder - The folder the bytes are kept in.
     */
    constructor(readonly name: string, folder: FsPath) {
        this.session = new FsStorageSession(resolveFileStorageNaming(name), folder);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async put(key: string, data: Readable): Promise<void> {
        await this.session.put(key, data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async get(key: string, maxBytes: number): Promise<Readable> {
        return await this.session.get(key, maxBytes);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findEntry(key: string): Promise<FileStoreEntry | undefined> {
        return await this.session.findEntry(key);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    findKeys(prefix: string): AsyncIterable<string[]> {
        return this.session.findKeys(prefix);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete(keys: string[]): Promise<void> {
        await this.session.delete(keys);
    }
}