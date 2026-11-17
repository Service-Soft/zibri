import { Readable } from 'node:stream';

import { BackupTransportSessionInterface } from '../../backup/transports/backup-transport-session.interface';

/**
 * What a test does instead of a session's `put` or `get`, handed the session's own to call through.
 */
export type BackupTransportSessionInterception = {
    /**
     * Instead of `put`.
     */
    put?: (key: string, data: Readable, put: (key: string, data: Readable) => Promise<void>) => Promise<void>,
    /**
     * Instead of `get`.
     */
    get?: (key: string, maxBytes: number, get: (key: string, maxBytes: number) => Promise<Readable>) => Promise<Readable>
};

/**
 * What tests of the backups do with the sessions of a transport.
 */
export class BackupTransportSessionTestUtilities {
    /**
     * A session of a transport whose `put` or `get` a test takes the place of, such as to count the
     * resources stored at once, or to fail one part way. Everything else is the session's own.
     * @param session - The session.
     * @param interception - What the test does instead.
     * @returns The session to hand out.
     */
    static intercept(
        session: BackupTransportSessionInterface,
        interception: BackupTransportSessionInterception
    ): BackupTransportSessionInterface {
        const put: (key: string, data: Readable) => Promise<void> = async (key, data) => await session.put(key, data);
        const get: (key: string, maxBytes: number) => Promise<Readable> = async (key, maxBytes) => await session.get(key, maxBytes);
        return {
            put: async (key, data) => await (interception.put?.(key, data, put) ?? put(key, data)),
            get: async (key, maxBytes) => await (interception.get?.(key, maxBytes, get) ?? get(key, maxBytes)),
            findKeys: prefix => session.findKeys(prefix),
            findNames: path => session.findNames(path),
            delete: async keys => await session.delete(keys),
            close: async () => await session.close()
        };
    }

    /**
     * Whether a key is the record of a backup rather than the data of a resource.
     * @param key - The key.
     * @returns True for `<backup name>/metadata.json` of format 1 and `.../backups/<id>/record.json` of format 2.
     */
    static isRecordKey(key: string): boolean {
        return key.endsWith('/metadata.json') || key.endsWith('/record.json');
    }
}