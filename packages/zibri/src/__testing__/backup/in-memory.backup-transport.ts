import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { BackupKeyNotFoundError } from '../../backup/transports/backup-key-not-found.error';
import { BackupTransportSessionInterface } from '../../backup/transports/backup-transport-session.interface';
import { BackupTransportInterface } from '../../backup/transports/backup-transport.interface';
import { resolveBackupKeySegments } from '../../backup/transports/resolve-backup-key-segments.function';
import { InternalError } from '../../error-handling/internal-error.model';

// how many keys a page of findKeys holds
const PAGE_SIZE: number = 1000;

/**
 * A transport in memory, for tests of what is built on transports: what it holds can be read and
 * changed directly, and it counts the sessions that are open.
 */
export class InMemoryBackupTransport implements BackupTransportInterface<'v2'> {
    /**
     * The versions the transport supports.
     */
    readonly versions: readonly 'v2'[] = ['v2'];

    /**
     * What the transport holds, by key.
     */
    readonly blobs: Map<string, Buffer> = new Map();

    /**
     * How many sessions are open right now.
     */
    openSessions: number = 0;

    /**
     * Creates a transport holding nothing yet.
     * @param name - The name of the transport.
     */
    constructor(readonly name: string) {}

    async openSession(): Promise<BackupTransportSessionInterface> {
        this.openSessions++;
        let closed: boolean = false;
        return await Promise.resolve({
            put: async (key: string, data: Readable) => {
                resolveBackupKeySegments(this.name, key);
                // read to its end first, so that a put that fails leaves the key as it was
                this.blobs.set(key, await buffer(data));
            },
            get: async (key: string, maxBytes: number) => {
                const blob: Buffer | undefined = this.blobs.get(key);
                if (blob == undefined) {
                    throw new BackupKeyNotFoundError(this.name, key);
                }
                if (blob.length > maxBytes) {
                    throw new InternalError(`"${key}" is ${blob.length} bytes, larger than the ${maxBytes} it may be.`);
                }
                return await Promise.resolve(Readable.from([blob]));
            },
            findKeys: (prefix: string) => this.findKeys(prefix),
            findNames: (path: string) => this.findNames(path),
            delete: async (keys: string[]) => {
                for (const key of keys) {
                    this.blobs.delete(key);
                }
                await Promise.resolve();
            },
            close: async () => {
                if (!closed) {
                    closed = true;
                    this.openSessions--;
                }
                await Promise.resolve();
            }
        });
    }

    private async* findKeys(prefix: string): AsyncIterable<string[]> {
        const keys: string[] = [...this.blobs.keys()].filter(key => key.startsWith(prefix));
        for (let i: number = 0; i < keys.length; i += PAGE_SIZE) {
            yield await Promise.resolve(keys.slice(i, i + PAGE_SIZE));
        }
    }

    private async* findNames(path: string): AsyncIterable<string[]> {
        const prefix: string = path === '' ? '' : `${resolveBackupKeySegments(this.name, path).join('/')}/`;
        const names: string[] = [
            ...new Set(
                [...this.blobs.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length).split('/')[0] ?? '')
            )
        ];
        for (let i: number = 0; i < names.length; i += PAGE_SIZE) {
            yield await Promise.resolve(names.slice(i, i + PAGE_SIZE));
        }
    }
}