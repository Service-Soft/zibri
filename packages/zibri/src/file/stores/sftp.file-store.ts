import { Readable } from 'node:stream';

import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { SftpStorageOptions } from '../../storage/sftp-storage-options.model';
import { SftpStorageSession } from '../../storage/sftp.storage-session';
import { optionalPeer } from '../../utilities/optional-peer.function';
import { FileStoreEntry } from './file-store-entry.model';
import { FileStoreInterface } from './file-store.interface';
import { resolveFileStorageNaming } from './resolve-file-storage-naming.function';

const NEEDED_FOR: string = 'The sftp file store';

/**
 * A file store that keeps the bytes in a folder on a server reached over SFTP: each key a file under `path`, its
 * segments the folders leading to it. Each call connects on its own. Needs the optional peer dependency `ssh2`.
 */
export class SftpFileStore implements FileStoreInterface {
    /**
     * Creates the store keeping the bytes on the given server.
     * @param name - The name of the store.
     * @param options - Where the server is, how to log in, and the folder the bytes are kept in.
     */
    constructor(readonly name: string, private readonly options: SftpStorageOptions) {
        // when the store is built rather than at the first file, which can be days after the deployment that left
        // the package out
        optionalPeer('ssh2', NEEDED_FOR);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async put(key: string, data: Readable): Promise<void> {
        await this.withSession(async session => await session.put(key, data));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async get(key: string, maxBytes: number): Promise<Readable> {
        const session: SftpStorageSession = await this.openSession();
        try {
            const data: Readable = await session.get(key, maxBytes);
            // the connection belongs to the stream from here on, until it is read or destroyed
            data.once('close', () => this.closeSession(session));
            return data;
        }
        catch (error) {
            this.closeSession(session);
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findEntry(key: string): Promise<FileStoreEntry | undefined> {
        return await this.withSession(async session => await session.findEntry(key));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* findKeys(prefix: string): AsyncIterable<string[]> {
        // one connection for the whole listing, which walks a folder per round trip
        const session: SftpStorageSession = await this.openSession();
        try {
            yield* session.findKeys(prefix);
        }
        finally {
            await session.close();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete(keys: string[]): Promise<void> {
        await this.withSession(async session => await session.delete(keys));
    }

    private async openSession(): Promise<SftpStorageSession> {
        // a server is kept the same way a backup transport keeps one, so the session is the one both stand on.
        // Per call rather than held open: the file service asks for one thing at a time, which can be days apart
        return await SftpStorageSession.open(resolveFileStorageNaming(this.name), this.options, NEEDED_FOR);
    }

    private async withSession<T>(work: (session: SftpStorageSession) => Promise<T>): Promise<T> {
        const session: SftpStorageSession = await this.openSession();
        try {
            return await work(session);
        }
        finally {
            await session.close();
        }
    }

    private closeSession(session: SftpStorageSession): void {
        // what was read is in hand by now: a connection that fails to close loses nothing of it
        void (async (): Promise<void> => {
            try {
                await session.close();
            }
            catch (error) {
                inject(ZIBRI_DI_TOKENS.LOGGER).warn(
                    `Could not close a connection of the file store "${this.name}": `
                    + (error instanceof Error ? error.message : String(error))
                );
            }
        })();
    }
}