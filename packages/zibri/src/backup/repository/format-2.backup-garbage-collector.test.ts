import assert from 'node:assert';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { BackupChunkUtilities } from './backup-chunk.utilities';
import { BackupChunkingOptions } from './backup-chunking-options.model';
import { BackupRepositoryKey } from './backup-repository-key.model';
import { Format2BackupGarbageCollector } from './format-2.backup-garbage-collector';
import { Format2BackupLayout } from './format-2.backup-layout';
import { RetrievedBackupResource } from './retrieved-backup-resource.model';
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
import { JsonUtilities } from '../../utilities/json.utilities';
import { BackupChunkEntity, BackupChunkEntityCreateData } from '../backup-chunk-entity.model';
import { BackupDigest } from '../backup-digest.model';
import { BackupEntity, BackupEntityCreateData } from '../backup-entity.model';
import { BACKUP_REPOSITORY_FOLDER } from '../backup-format';
import { BackupResourceEntity } from '../backup-resource-entity.model';
import { BackupStatus } from '../backup-status.enum';

// small, so that a few MiB of data make dozens of chunks
const CHUNKING: BackupChunkingOptions = { minChunkBytes: 16 * 1024, averageChunkBytes: 64 * 1024, maxChunkBytes: 256 * 1024, compressionLevel: 3 };

describe('Format2BackupGarbageCollector', () => {
    let server: StartedTestServer;
    const store: InMemoryBackupTransport = new InMemoryBackupTransport('in-memory');
    let layout: Format2BackupLayout;
    let collector: Format2BackupGarbageCollector;

    function getChunkRepository(): Repository<BackupChunkEntity, BackupChunkEntityCreateData> {
        return inject(repositoryTokenFor(BackupChunkEntity));
    }

    function getBackupRepository(): Repository<BackupEntity, BackupEntityCreateData> {
        return inject(repositoryTokenFor(BackupEntity));
    }

    /**
     * Stores data as the one resource of a new backup, encrypted, recorded completed in the database and
     * on the store, as a backup that completed is.
     * @param name - The name of the backup.
     * @param data - The data.
     * @returns The backup, with its resource.
     */
    async function storeBackup(name: string, data: Buffer): Promise<BackupEntity> {
        const created: BackupEntity = await getBackupRepository().create({
            name,
            status: BackupStatus.RUNNING,
            masterKeys: [],
            dataKeyIds: [],
            resources: [{ name: 'Data', transportNames: [store.name] }]
        });
        const backup: BackupEntity = await getBackupRepository().findById(created.id, { relations: ['resources'] });
        const [resource] = backup.resources;
        if (resource == undefined) {
            throw new Error('the backup has no resource');
        }
        const key: BackupRepositoryKey = await layout.resolveRepositoryKey([store], undefined);
        const pieces: Buffer[] = Array.from({ length: Math.ceil(data.length / 65_536) }, (_, i) => data.subarray(i * 65_536, (i + 1) * 65_536));
        const digest: BackupDigest = await layout.storeChunks([store], backup, resource, Readable.from(pieces), key, new AbortController().signal);
        await inject(repositoryTokenFor(BackupResourceEntity)).updateById(resource.id, { ...digest, completed: true });
        await getBackupRepository().updateById(backup.id, { status: BackupStatus.COMPLETED });
        const completed: BackupEntity = await getBackupRepository().findById(backup.id, { relations: ['resources'] });
        await layout.storeRecord(store, completed, JsonUtilities.stringify(completed));
        return completed;
    }

    /**
     * Deletes a backup the way the service deletes one: its record, its manifests and its rows. Its chunks stay.
     * @param backup - The backup, with its resources.
     */
    async function deleteBackup(backup: BackupEntity): Promise<void> {
        await layout.deleteRecord(store, backup);
        await layout.deleteResources(store, backup, backup.resources);
        await inject(repositoryTokenFor(BackupResourceEntity)).deleteAll({ backupId: backup.id });
        await getBackupRepository().deleteById(backup.id);
    }

    async function retrieve(backup: BackupEntity): Promise<Buffer> {
        const [resource] = backup.resources;
        if (resource == undefined) {
            throw new Error('the backup has no resource');
        }
        const retrieved: RetrievedBackupResource = await layout.retrieve(store, backup, resource, undefined);
        return await buffer(retrieved.kind === 'chunks' ? Readable.from(BackupChunkUtilities.openAll(retrieved.chunks, retrieved.key)) : retrieved.data);
    }

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, BackupEntity, BackupResourceEntity, BackupChunkEntity],
                    repositories: defaultTestServerRepositories
                })
            ],
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_CHUNKING_OPTIONS, useValue: CHUNKING })]
        });
        layout = new Format2BackupLayout(() => getChunkRepository());
        collector = new Format2BackupGarbageCollector(layout, () => getChunkRepository());
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('keeps a chunk a backup found stored between two windows and named, while it deletes the rest', async () => {
        // a window's worth of garbage first, so that the first window deletes these and the second the chunks below
        const fakes: string[] = Array.from({ length: 1000 }, () => `${BACKUP_REPOSITORY_FOLDER}/chunks/00/00${randomBytes(31).toString('hex')}`);
        for (const key of fakes) {
            store.blobs.set(key, randomBytes(64));
        }
        const data: Buffer = randomBytes(2 * 1024 * 1024);
        await deleteBackup(await storeBackup('deleted', data));
        let windows: number = 0;
        let between: BackupEntity | undefined;

        await collector.collect(store, async work => {
            windows++;
            if (windows === 2) {
                // stored by a backup between the two windows, which finds the chunks of the deleted one still
                // recorded and names them
                between = await storeBackup('between-windows', data);
            }
            return await work(new AbortController().signal);
        }, undefined);

        expect(windows).toBe(2);
        assert(between, 'nothing was stored between the windows');
        expect(fakes.some(key => store.blobs.has(key))).toBe(false);
        expect((await retrieve(between)).equals(data)).toBe(true);
    }, 30000);

    it('deletes nothing in a window it lost', async () => {
        const fakes: string[] = Array.from({ length: 10 }, () => `${BACKUP_REPOSITORY_FOLDER}/chunks/00/00${randomBytes(31).toString('hex')}`);
        for (const key of fakes) {
            store.blobs.set(key, randomBytes(64));
        }
        const lost: AbortController = new AbortController();
        lost.abort(new Error('the window was lost'));

        await expect(collector.collect(store, async work => await work(lost.signal), undefined)).rejects.toThrow('the window was lost');

        expect(fakes.every(key => store.blobs.has(key))).toBe(true);
        // and collects them in a window it holds
        await collector.collect(store, async work => await work(new AbortController().signal), undefined);
        expect(fakes.some(key => store.blobs.has(key))).toBe(false);
    }, 30000);

    it('refuses to scrub on a cycle that is no whole number of days from 1 to 256', () => {
        for (const cycleInDays of [0, 1.5, 257]) {
            expect(() => Format2BackupGarbageCollector.validateScrubOptions({ cycleInDays })).toThrow('needs to be a whole number from 1 to 256');
        }
        expect(() => Format2BackupGarbageCollector.validateScrubOptions({ cycleInDays: 30 })).not.toThrow();
    });
});