/* eslint-disable typescript/no-deprecated -- format 1 is stored through the members of v1, which 3.x keeps until 4.0 */
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { InMemoryBackupTransport } from '../../__testing__/backup/in-memory.backup-transport';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { LoggerInterface } from '../../logging/logger.interface';
import { BackupEntity } from '../backup-entity.model';
import { BACKUP_REPOSITORY_FOLDER } from '../backup-format';
import { BackupResourceEntity } from '../backup-resource-entity.model';
import { Format1BackupTransport } from './format-1.backup-transport';

/**
 * A backup and one resource of it, as the transport is called with them.
 * @param backupName - The name of the backup.
 * @param size - The size recorded for the resource, if any.
 * @returns The backup and its resource.
 */
function resolveBackup(backupName: string, size: number | undefined): [BackupEntity, BackupResourceEntity] {
    return [Object.assign(new BackupEntity(), { name: backupName }), Object.assign(new BackupResourceEntity(), { name: 'Data', size })];
}

describe('Format1BackupTransport', () => {
    let server: StartedTestServer;
    let store: InMemoryBackupTransport;
    let transport: Format1BackupTransport;

    beforeAll(async () => {
        // for the logger the transport warns through
        server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })] });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    beforeEach(() => {
        store = new InMemoryBackupTransport('in-memory');
        transport = new Format1BackupTransport(store);
    });

    it('stores a resource and the record under the keys the transports always stored them under', async () => {
        const [backup, resource] = resolveBackup('nightly', 4);

        await transport.storeData(Readable.from([Buffer.from('data')]), backup, resource);
        await transport.storeMetadata(backup, '{"name":"nightly"}');

        expect([...store.blobs].map(([key, blob]) => [key, blob.toString()])).toEqual([
            ['nightly/Data', 'data'],
            ['nightly/metadata.json', '{"name":"nightly"}']
        ]);
        expect(transport.name).toBe('in-memory');
    });

    it('hands back the record of every backup it holds and is not told of, as it was stored', async () => {
        store.blobs.set('known/metadata.json', Buffer.from('{"name":"known"}'));
        store.blobs.set('new/metadata.json', Buffer.from('{"name":"new"}'));
        store.blobs.set('new/Data', Buffer.from('data'));
        // directly under the root, which no backup is
        store.blobs.set('stray', Buffer.from('stray'));

        expect(await transport.resolveBackups(['known'])).toEqual(['{"name":"new"}']);
    });

    it('warns about a backup without a record, and hands back none of it', async () => {
        store.blobs.set('interrupted/Data', Buffer.from('data'));
        const warn: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'warn');
        try {
            expect(await transport.resolveBackups([])).toEqual([]);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not find the metadata file needed to resolve a backup: "interrupted"'));
        }
        finally {
            warn.mockRestore();
        }
    });

    it('leaves the folder of deduplicated backups alone, and warns about nothing in it', async () => {
        store.blobs.set(`${BACKUP_REPOSITORY_FOLDER}/chunks/ab/ab01`, Buffer.from('a chunk'));
        store.blobs.set(`${BACKUP_REPOSITORY_FOLDER}/backups/1/record.json`, Buffer.from('{"name":"deduplicated"}'));
        const warn: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'warn');
        try {
            expect(await transport.resolveBackups([])).toEqual([]);
            expect(warn).not.toHaveBeenCalled();
        }
        finally {
            warn.mockRestore();
        }
    });

    it('refuses to retrieve a resource larger than recorded, or one without a recorded size', async () => {
        store.blobs.set('nightly/Data', Buffer.from('more than recorded'));

        await expect(transport.retrieveData(...resolveBackup('nightly', 4))).rejects.toThrow('larger than the 4 it may be');
        await expect(transport.retrieveData(...resolveBackup('nightly', undefined))).rejects.toThrow('recorded no size');
        expect(store.openSessions).toBe(0);
    });

    it('closes every session it opens, the one of a retrieval once its stream is read or destroyed', async () => {
        const [backup, resource] = resolveBackup('nightly', 4);
        await transport.storeData(Readable.from([Buffer.from('data')]), backup, resource);
        await transport.storeMetadata(backup, '{}');
        await transport.resolveBackups([]);
        expect(store.openSessions).toBe(0);

        const read: Readable = await transport.retrieveData(backup, resource);
        expect(store.openSessions).toBe(1);
        expect(await text(read)).toBe('data');
        await new Promise(resolve => setImmediate(resolve));
        expect(store.openSessions).toBe(0);

        const destroyed: Readable = await transport.retrieveData(backup, resource);
        destroyed.destroy();
        await new Promise(resolve => setImmediate(resolve));
        expect(store.openSessions).toBe(0);
    });

    it('deletes the data of a resource and the record, leaving no key of the backup', async () => {
        const [backup, resource] = resolveBackup('nightly', 4);
        await transport.storeData(Readable.from([Buffer.from('data')]), backup, resource);
        await transport.storeMetadata(backup, '{}');

        await transport.deleteMetadata(backup);
        await transport.deleteData(backup, resource);

        expect([...store.blobs.keys()]).toEqual([]);
    });
});