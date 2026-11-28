import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { SftpStorageOptions } from '../../storage/sftp-storage-options.model';
import { SftpStorageSession } from '../../storage/sftp.storage-session';
import { JsonUtilities } from '../../utilities/json.utilities';
import { Ms } from '../../utilities/ms';
import { optionalPeer } from '../../utilities/optional-peer.function';
import { FileStoreEntry } from './file-store-entry.model';
import { FileStoreInterface } from './file-store.interface';
import { resolveFileStorageNaming } from './resolve-file-storage-naming.function';

const NEEDED_FOR: string = 'The sftp file store';

/**
 * How long a connection is kept once no call uses it any more.
 */
// the calls of one burst, such as the files of an import, follow one another within milliseconds, while the file
// service may ask for the next thing days later. And a connection kept holds a process that shuts down this long
const IDLE_CLOSE_MS: number = 2 * Ms.SECOND;

/**
 * A connection the calls of a store share while it is in use.
 */
type SharedSession = {
    /**
     * The session, once it is open.
     */
    session: Promise<SftpStorageSession>,
    /**
     * How many calls use it.
     */
    users: number,
    /**
     * What closes it once no call uses it any more.
     */
    idleTimer: NodeJS.Timeout | undefined
};

/**
 * A file store that keeps the bytes in a folder on a server reached over SFTP: each key a file under `path`, its
 * segments the folders leading to it. Calls at the same time share one connection, which closes shortly after the
 * last of them. Needs the optional peer dependency `ssh2`.
 */
export class SftpFileStore implements FileStoreInterface {
    // by store and connection rather than by instance: a store of a tenant is built for each call, and calls at once
    // each logging in were one login after the other, and refused by a server limiting the logins it starts at once
    private static readonly sharedSessions: Map<string, SharedSession> = new Map();

    // a hash, so that the credentials are kept nowhere but in the options
    private readonly sessionKey: string;

    /**
     * Creates the store keeping the bytes on the given server.
     * @param name - The name of the store.
     * @param options - Where the server is, how to log in, and the folder the bytes are kept in.
     */
    constructor(readonly name: string, private readonly options: SftpStorageOptions) {
        // when the store is built rather than at the first file, which can be days after the deployment that left
        // the package out
        optionalPeer('ssh2', NEEDED_FOR);
        this.sessionKey = createHash('sha256').update(JsonUtilities.stringify({ name, options }))
            .digest('hex');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async put(key: string, data: Readable): Promise<void> {
        await this.withSession(async session => await session.put(key, data));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async get(key: string, maxBytes: number): Promise<Readable> {
        const shared: SharedSession = await this.acquireSession();
        try {
            const data: Readable = await (await shared.session).get(key, maxBytes);
            // the connection is used by the stream from here on, until it is read or destroyed
            data.once('close', () => this.releaseSession(shared));
            return data;
        }
        catch (error) {
            this.releaseSession(shared);
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
        const shared: SharedSession = await this.acquireSession();
        try {
            yield* (await shared.session).findKeys(prefix);
        }
        finally {
            this.releaseSession(shared);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete(keys: string[]): Promise<void> {
        await this.withSession(async session => await session.delete(keys));
    }

    private async withSession<T>(work: (session: SftpStorageSession) => Promise<T>): Promise<T> {
        const shared: SharedSession = await this.acquireSession();
        try {
            return await work(await shared.session);
        }
        finally {
            this.releaseSession(shared);
        }
    }

    /**
     * Resolves the connection a call uses: the one the calls at the same time share, or a new one where there is none
     * or it ended.
     * @returns The connection, counted as used until `releaseSession`.
     * @throws The error a connection failed to open with, for every call that waited for it.
     */
    private async acquireSession(): Promise<SharedSession> {
        const existing: SharedSession | undefined = SftpFileStore.sharedSessions.get(this.sessionKey);
        if (existing != undefined) {
            clearTimeout(existing.idleTimer);
            existing.idleTimer = undefined;
            existing.users++;
            try {
                if (!(await existing.session).isEnded) {
                    return existing;
                }
            }
            catch (error) {
                this.releaseSession(existing);
                throw error;
            }
            // ended while it was kept, such as by the server closing it: replaced, and closed by whoever still uses it
            this.releaseSession(existing);
            if (SftpFileStore.sharedSessions.get(this.sessionKey) === existing) {
                SftpFileStore.sharedSessions.delete(this.sessionKey);
            }
            return await this.acquireSession();
        }
        const opened: SharedSession = {
            // a server is kept the same way a backup transport keeps one, so the session is the one both stand on
            session: SftpStorageSession.open(resolveFileStorageNaming(this.name), this.options, NEEDED_FOR),
            users: 1,
            idleTimer: undefined
        };
        SftpFileStore.sharedSessions.set(this.sessionKey, opened);
        try {
            await opened.session;
            return opened;
        }
        catch (error) {
            // the next call tries again rather than every later one failing with this error
            if (SftpFileStore.sharedSessions.get(this.sessionKey) === opened) {
                SftpFileStore.sharedSessions.delete(this.sessionKey);
            }
            throw error;
        }
    }

    /**
     * Counts a call as done with a connection, which closes shortly after the last call that used it.
     * @param shared - The connection.
     */
    private releaseSession(shared: SharedSession): void {
        shared.users--;
        if (shared.users > 0) {
            return;
        }
        clearTimeout(shared.idleTimer);
        shared.idleTimer = setTimeout(() => {
            if (shared.users > 0) {
                return;
            }
            if (SftpFileStore.sharedSessions.get(this.sessionKey) === shared) {
                SftpFileStore.sharedSessions.delete(this.sessionKey);
            }
            this.closeSession(shared);
        }, IDLE_CLOSE_MS);
    }

    private closeSession(shared: SharedSession): void {
        // what was read is in hand by now: a connection that fails to close loses nothing of it
        void (async (): Promise<void> => {
            try {
                await (await shared.session).close();
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