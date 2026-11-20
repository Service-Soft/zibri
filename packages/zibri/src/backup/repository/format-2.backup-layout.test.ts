import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { setTimeout } from 'node:timers/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { BackupTransportSessionTestUtilities } from '../../__testing__/backup/backup-transport-session-test.utilities';
import { InMemoryBackupTransport } from '../../__testing__/backup/in-memory.backup-transport';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { LoggerInterface } from '../../logging/logger.interface';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { BackupChunkEntity, BackupChunkEntityCreateData } from '../backup-chunk-entity.model';
import { BackupDigest } from '../backup-digest.model';
import { BackupEntity } from '../backup-entity.model';
import { BACKUP_REPOSITORY_FOLDER } from '../backup-format';
import { BackupResourceEntity } from '../backup-resource-entity.model';
import { BackupTransportSessionInterface } from '../transports/backup-transport-session.interface';
import { BackupTransportInterface, BackupTransportSupporting } from '../transports/backup-transport.interface';
import { BackupChunkUtilities } from './backup-chunk.utilities';
import { BackupChunkingOptions } from './backup-chunking-options.model';
import { BackupRepositoryKey } from './backup-repository-key.model';
import { Format2BackupLayout } from './format-2.backup-layout';
import { RetrievedBackupResource } from './retrieved-backup-resource.model';

// small, so that a few MiB of data make dozens of chunks
const CHUNKING: BackupChunkingOptions = { minChunkBytes: 16 * 1024, averageChunkBytes: 64 * 1024, maxChunkBytes: 256 * 1024, compressionLevel: 3 };

/**
 * A backup and one resource of it, each with an id of its own.
 * @returns The backup and its resource.
 */
function resolveBackup(): [BackupEntity, BackupResourceEntity] {
    const backup: BackupEntity = Object.assign(new BackupEntity(), { id: UUIDUtilities.generate(), name: 'nightly' });
    return [backup, Object.assign(new BackupResourceEntity(), { id: UUIDUtilities.generate(), name: 'Data', backupId: backup.id })];
}

/**
 * A store whose puts are counted by key.
 */
class CountedStore implements BackupTransportInterface<'v2'> {
    readonly versions: readonly 'v2'[] = ['v2'];

    readonly puts: string[] = [];

    constructor(readonly inner: InMemoryBackupTransport) {}

    get name(): string {
        return this.inner.name;
    }

    async openSession(): Promise<BackupTransportSessionInterface> {
        return BackupTransportSessionTestUtilities.intercept(await this.inner.openSession(), {
            put: async (key, data, put) => {
                this.puts.push(key);
                await put(key, data);
            }
        });
    }

    chunkPuts(): string[] {
        return this.puts.filter(key => key.includes('chunks/'));
    }
}

describe('Format2BackupLayout', () => {
    let server: StartedTestServer;
    let layout: Format2BackupLayout;
    let store: CountedStore;
    const data: Buffer = randomBytes(2 * 1024 * 1024);

    /**
     * Stores data as a resource of a new backup.
     * @param target - Where to store it.
     * @param stored - The data.
     * @param encrypt - Whether to encrypt it.
     * @returns The backup, its resource as recorded, and what was stored.
     */
    async function storeResource(
        target: BackupTransportSupporting<'v2'>[],
        stored: Buffer,
        encrypt: boolean = true
    ): Promise<[BackupEntity, BackupResourceEntity]> {
        const [backup, resource] = resolveBackup();
        // in pieces, as a staged file is read
        const pieces: Buffer[] = Array.from({ length: Math.ceil(stored.length / 65_536) }, (_, i) => stored.subarray(i * 65_536, (i + 1) * 65_536));
        const key: BackupRepositoryKey | undefined = encrypt ? await layout.resolveRepositoryKey(target, undefined) : undefined;
        const digest: BackupDigest = await layout.storeChunks(target, backup, resource, Readable.from(pieces), key, new AbortController().signal);
        return [backup, Object.assign(resource, digest)];
    }

    /**
     * Reads a resource back the way a restore reads it, and its checksum.
     * @param from - The store.
     * @param backup - The backup.
     * @param resource - The resource.
     * @returns The data and its checksum.
     */
    async function retrieve(from: BackupTransportSupporting<'v2'>, backup: BackupEntity, resource: BackupResourceEntity): Promise<[Buffer, string]> {
        // the key read from the store, as a restore without the bytes the backup recorded reads it
        const retrieved: RetrievedBackupResource = await layout.retrieve(from, backup, resource, undefined);
        if (retrieved.kind !== 'chunks') {
            throw new Error('retrieved in one piece');
        }
        const read: Buffer = await buffer(Readable.from(BackupChunkUtilities.openAll(retrieved.chunks, retrieved.key)));
        expect(read.length).toBe(retrieved.size);
        return [read, retrieved.checksum];
    }

    function getChunkRepository(): Repository<BackupChunkEntity, BackupChunkEntityCreateData> {
        return inject(repositoryTokenFor(BackupChunkEntity));
    }

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, BackupChunkEntity], repositories: defaultTestServerRepositories })],
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_CHUNKING_OPTIONS, useValue: CHUNKING })]
        });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    beforeEach(async () => {
        await getChunkRepository().deleteAll({});
        layout = new Format2BackupLayout(() => getChunkRepository());
        store = new CountedStore(new InMemoryBackupTransport('in-memory'));
    });

    it('restores the data of a resource byte for byte, from encrypted chunks and from unencrypted ones', async () => {
        for (const encrypt of [true, false]) {
            const [backup, resource] = await storeResource([store], data, encrypt);

            const [read, checksum] = await retrieve(store, backup, resource);

            expect(read.equals(data)).toBe(true);
            expect(checksum).toBe(resource.checksum);
            expect(resource.size).toBe(data.length);
        }
        const keys: string[] = [...store.inner.blobs.keys()];
        expect(keys.filter(k => k.startsWith(`${BACKUP_REPOSITORY_FOLDER}/chunks/`)).length).toBeGreaterThan(10);
        expect(keys.filter(k => k.startsWith(`${BACKUP_REPOSITORY_FOLDER}/plain-chunks/`)).length).toBeGreaterThan(10);
        expect(keys.filter(k => k.startsWith(`${BACKUP_REPOSITORY_FOLDER}/keys/`))).toHaveLength(1);
        expect(keys.every(k => k.startsWith(`${BACKUP_REPOSITORY_FOLDER}/`))).toBe(true);
    });

    it('keeps no readable data on the store of an encrypted resource, and a checksum that is not its sha256', async () => {
        const marked: Buffer = Buffer.from('only-readable-with-the-master-key '.repeat(100_000));
        const [, resource] = await storeResource([store], marked);

        for (const blob of store.inner.blobs.values()) {
            expect(blob.includes('only-readable-with-the-master-key')).toBe(false);
        }
        expect(resource.checksum).not.toBe(createHash('sha256').update(marked)
            .digest('hex'));
    });

    it('stores no chunk a second time when the data has not changed, only the manifest', async () => {
        await storeResource([store], data);
        const first: number = store.chunkPuts().length;

        await storeResource([store], data);

        expect(store.chunkPuts()).toHaveLength(first);
    });

    it('stores only the chunks around an insert again', async () => {
        await storeResource([store], data);
        const first: number = store.chunkPuts().length;
        const middle: number = data.length / 2;
        const inserted: Buffer = Buffer.concat([data.subarray(0, middle), Buffer.from('a row written in between'), data.subarray(middle)]);

        const [backup, resource] = await storeResource([store], inserted);

        expect(store.chunkPuts().length - first).toBeLessThanOrEqual(2);
        expect((await retrieve(store, backup, resource))[0].equals(inserted)).toBe(true);
    });

    it('stores every chunk on every store, under one repository key, and restores from each', async () => {
        const second: CountedStore = new CountedStore(new InMemoryBackupTransport('second'));

        const [backup, resource] = await storeResource([store, second], data);

        for (const s of [store, second]) {
            expect((await retrieve(s, backup, resource))[0].equals(data)).toBe(true);
        }
        const keyFiles: (s: CountedStore) => string[] = s => [...s.inner.blobs.keys()].filter(k => k.includes('/keys/'));
        expect(keyFiles(second)).toEqual(keyFiles(store));
    });

    it('reads the repository key back from the store in a process that never saw it', async () => {
        const [backup, resource] = await storeResource([store], data);

        layout = new Format2BackupLayout(() => getChunkRepository());

        expect((await retrieve(store, backup, resource))[0].equals(data)).toBe(true);
        // and backs up under the same key, so the chunks are the ones stored already
        const before: number = store.chunkPuts().length;
        await storeResource([store], data);
        expect(store.chunkPuts()).toHaveLength(before);
    });

    it('refuses to back up to stores holding different repository keys', async () => {
        const other: CountedStore = new CountedStore(new InMemoryBackupTransport('other'));
        await storeResource([store], data);
        // the key of another application, which an empty store gets from the first backup into it
        await new Format2BackupLayout(() => getChunkRepository()).resolveRepositoryKey([other], undefined);

        await expect(storeResource([store, other], data)).rejects.toThrow('needs to hold the repository key of the others, or none');
    });

    it('gives a store holding no key the key the application already encrypts with', async () => {
        const second: CountedStore = new CountedStore(new InMemoryBackupTransport('second'));
        await storeResource([store], data);

        await storeResource([second], data);
        const [backup, resource] = await storeResource([store], data);

        const keyFiles: (s: CountedStore) => string[] = s => [...s.inner.blobs.keys()].filter(k => k.includes('/keys/'));
        expect(keyFiles(second)).toEqual(keyFiles(store));
        // read with the key the store holds, as a process that never saw it reads it
        layout = new Format2BackupLayout(() => getChunkRepository());
        expect((await retrieve(store, backup, resource))[0].equals(data)).toBe(true);
    });

    it('gives the stores of each tenant a key of their own, whichever owner the process resolved a key for first', async () => {
        const tenant: string = UUIDUtilities.generate();
        // a process whose first backup is of a tenant, on stores that hold no key yet
        const ofTenant: BackupRepositoryKey = await layout.resolveRepositoryKey([new InMemoryBackupTransport('of-a-tenant')], tenant);
        const ofApplication: BackupRepositoryKey = await layout.resolveRepositoryKey([new InMemoryBackupTransport('of-the-application')], undefined);
        const addedSince: BackupRepositoryKey = await layout.resolveRepositoryKey([new InMemoryBackupTransport('of-a-tenant, added since')], tenant);
        const ofOther: BackupRepositoryKey = await layout.resolveRepositoryKey([new InMemoryBackupTransport('of-another-tenant')], UUIDUtilities.generate());

        expect(ofApplication.id).not.toBe(ofTenant.id);
        expect(addedSince.id).toBe(ofTenant.id);
        expect([ofTenant.id, ofApplication.id]).not.toContain(ofOther.id);
    });

    it('encrypts each store under the key it holds, after storing to one holding another key', async () => {
        const other: CountedStore = new CountedStore(new InMemoryBackupTransport('other'));
        // the key of another application, which an empty store gets from the first backup into it
        await new Format2BackupLayout(() => getChunkRepository()).resolveRepositoryKey([other], undefined);
        await storeResource([store], data);
        await storeResource([other], data);

        const [backup, resource] = await storeResource([store], data);

        layout = new Format2BackupLayout(() => getChunkRepository());
        expect((await retrieve(store, backup, resource))[0].equals(data)).toBe(true);
    });

    it('refuses unencrypted chunks in the place of a resource the backup recorded as encrypted', async () => {
        const [backup, resource] = await storeResource([store], data, false);

        await expect(layout.retrieve(store, backup, resource, randomBytes(64))).rejects.toThrow('holds it unencrypted');
    });

    it('lets every put to the other stores end before the sessions close when a put to one store fails', async () => {
        let putting: number = 0;
        const puttingAtClose: number[] = [];
        const slowInner: InMemoryBackupTransport = new InMemoryBackupTransport('slow');
        const slow: BackupTransportSupporting<'v2'> = {
            name: 'slow',
            openSession: async () => {
                const session: BackupTransportSessionInterface = BackupTransportSessionTestUtilities.intercept(await slowInner.openSession(), {
                    put: async (key, stored, put) => {
                        putting++;
                        try {
                            await setTimeout(100);
                            await put(key, stored);
                        }
                        finally {
                            putting--;
                        }
                    }
                });
                return {
                    ...session,
                    close: async () => {
                        puttingAtClose.push(putting);
                        await session.close();
                    }
                };
            }
        };
        const failingInner: InMemoryBackupTransport = new InMemoryBackupTransport('failing');
        const failing: BackupTransportSupporting<'v2'> = {
            name: 'failing',
            openSession: async () => BackupTransportSessionTestUtilities.intercept(await failingInner.openSession(), {
                put: async () => await Promise.reject(new Error('the store is gone'))
            })
        };

        await expect(storeResource([slow, failing], data, false)).rejects.toThrow('the store is gone');

        expect(puttingAtClose).toEqual([0]);
    });

    it('refuses a chunk that was changed where it is stored, and one that is gone, naming it', async () => {
        const [backup, resource] = await storeResource([store], data);
        const chunkKeys: string[] = [...store.inner.blobs.keys()].filter(k => k.includes('/chunks/'));
        const [changedKey, goneKey] = chunkKeys;
        if (changedKey == undefined || goneKey == undefined) {
            throw new Error('fewer than two chunks');
        }
        const changed: Buffer = Buffer.from(store.inner.blobs.get(changedKey) ?? Buffer.alloc(0));
        changed[changed.length - 20] = (changed[changed.length - 20] ?? 0) ^ 1;
        store.inner.blobs.set(changedKey, changed);

        await expect(retrieve(store, backup, resource)).rejects.toThrow(`The chunk ${changedKey.split('/').pop()} is not the chunk it is stored as`);

        store.inner.blobs.delete(goneKey);
        store.inner.blobs.delete(changedKey);
        await expect(retrieve(store, backup, resource)).rejects.toThrow('holds nothing');
    });

    it('hands back the records of backups not known yet, and warns about one whose record is missing', async () => {
        const [known] = await storeResource([store], data);
        const [recorded] = await storeResource([store], data);
        const [interrupted] = await storeResource([store], data);
        await layout.storeRecord(store, known, '{"name":"known"}');
        await layout.storeRecord(store, recorded, '{"name":"recorded"}');
        const warn: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'warn');
        try {
            expect(await layout.resolveRecords(store, [known.id])).toEqual(['{"name":"recorded"}']);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining(`Could not find the record needed to resolve the backup "${interrupted.id}"`));
        }
        finally {
            warn.mockRestore();
        }
    });

    it('deletes the record and the manifests of a backup and leaves its chunks, which other backups share', async () => {
        const [backup, resource] = await storeResource([store], data);
        await layout.storeRecord(store, backup, '{}');
        const chunks: number = [...store.inner.blobs.keys()].filter(k => k.includes('/chunks/')).length;

        await layout.deleteRecord(store, backup);
        await layout.deleteResources(store, backup, [resource]);

        expect([...store.inner.blobs.keys()].filter(k => k.includes(`/backups/${backup.id}/`))).toEqual([]);
        expect([...store.inner.blobs.keys()].filter(k => k.includes('/chunks/'))).toHaveLength(chunks);
    });

    it('writes no manifest once the lease the resource is stored under is lost', async () => {
        const [backup, resource] = resolveBackup();
        const lost: AbortController = new AbortController();
        lost.abort(new Error('the lease was lost'));

        await expect(layout.storeChunks([store], backup, resource, Readable.from([data]), undefined, lost.signal)).rejects.toThrow('the lease was lost');

        // a garbage collection holding the lease by now may have deleted chunks it found stored
        expect(store.puts.filter(key => key.endsWith(resource.id))).toEqual([]);
    });

    it('hands back the data of a resource stored in one piece as it was stored', async () => {
        const [backup, resource] = resolveBackup();
        await layout.storeWhole(store, backup, resource, Readable.from([data]));

        const retrieved: RetrievedBackupResource = await layout.retrieve(store, backup, Object.assign(resource, { size: data.length }), undefined);

        if (retrieved.kind !== 'whole') {
            throw new Error(`retrieved as ${retrieved.kind}`);
        }
        expect((await buffer(retrieved.data)).equals(data)).toBe(true);
    });

    it('records the chunks a store took, and fills an empty index from the store before storing anything again', async () => {
        await storeResource([store], data);
        const recorded: BackupChunkEntity[] = await getChunkRepository().findAll({ limit: 'all' });
        expect(recorded.map(r => r.key.slice('in-memory:'.length)).sort()).toEqual(store.chunkPuts().sort());

        // as after the database was replaced
        await getChunkRepository().deleteAll({});
        const before: number = store.chunkPuts().length;
        await storeResource([store], data);

        expect(store.chunkPuts()).toHaveLength(before);
        expect(await getChunkRepository().findAll({ limit: 'all' })).toHaveLength(recorded.length);
    });

    it('finds the chunks a store holds from its listing when the application does not declare the index', async () => {
        await storeResource([store], data);
        const before: number = store.chunkPuts().length;
        layout = new Format2BackupLayout(() => undefined);

        await storeResource([store], data);

        expect(store.chunkPuts()).toHaveLength(before);
    });
});