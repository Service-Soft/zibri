import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it, vi, MockInstance } from 'vitest';
import { InMemoryDataSource, testMasterKey } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model.ts';
import { BackupResourceEntity } from './backup-resource-entity.model.ts';
import { BackupServiceInterface } from './backup-service.interface.ts';
import { Backup } from './decorators/backup-resource.decorator.ts';
import { BackupTransport } from './decorators/backup-transport.decorator.ts';
import { BaseFsBackupTransport } from './transports/fs.backup-transport.ts';
import { testFileFolder } from '../__testing__/constants.ts';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { EncryptionMasterKey, EncryptionMasterOptions } from '../auth/encryption/encryption-master-options.model.ts';
import { AesGcmEncryptionStrategy } from '../auth/encryption/strategies/aes-gcm.encryption-strategy.ts';
import { DataSource } from '../data-source/decorators/data-source.decorator.ts';
import { Repository } from '../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { defineProvider, DiProvider } from '../di/models/di-provider.model.ts';
import { BaseEntity } from '../entity/base-entity.model.ts';
import { Entity } from '../entity/decorators/entity.decorator.ts';
import { Property } from '../entity/decorators/property.decorator.ts';
import { Newable } from '../types/newable.type.ts';
import { FsPath, FsUtilities } from '../utilities/fs.utilities.ts';

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'backups-encrypted');

/**
 * Written into every note, so that finding it in a stored archive means the archive can be read
 * without the master key.
 */
const MARKER: string = 'only-readable-with-the-master-key';

/**
 * How many notes are seeded - enough, at their size, for the archive to span several chunks.
 */
const NOTE_COUNT: number = 40;

/**
 * A master key that replaces the test server's own.
 */
const replacementMasterKey: EncryptionMasterKey<Buffer> = {
    id: 'mk2',
    value: createHash('sha256').update('zibri-test-replacement-master-key')
        .digest()
};

@BackupTransport()
class EncryptedFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'encrypted-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = backupFolder;
}

@Entity({ tenant: 'shared' })
class Note {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    text!: string;
}

@DataSource()
@Backup({ transports: [EncryptedFsBackupTransport], encrypt: true })
class EncryptedDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Note, BackupEntity, BackupResourceEntity];
}

/**
 * The test server's providers with the master key options replaced.
 * @param options - The master key options.
 * @returns The providers.
 */
function withMasterOptions(options: EncryptionMasterOptions<Buffer>): DiProvider<unknown>[] {
    return [
        ...defaultTestServerProviders,
        defineProvider({ token: ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS, useValue: options })
    ];
}

function getNoteRepository(): Repository<Note> {
    return inject(repositoryTokenFor(Note));
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

/**
 * Takes a backup and reads back its record.
 * @param name - What to name the backup.
 * @returns The record, holding its one resource.
 */
async function createBackup(name: string): Promise<BackupEntity> {
    await getBackupService().createBackup({ name });
    const [backup]: BackupEntity[] = await inject(repositoryTokenFor(BackupEntity)).findAll({
        where: { name },
        relations: ['resources']
    });
    assert(backup, 'the backup was not created');
    return backup;
}

function getResource(backup: BackupEntity): BackupResourceEntity {
    const [resource]: BackupResourceEntity[] = backup.resources;
    assert(resource, 'the backup holds no resources');
    return resource;
}

function getArchivePath(backup: BackupEntity): FsPath {
    return FsUtilities.getPath(backupFolder, backup.name, getResource(backup).name);
}

describe('BackupService — encrypted backups', () => {
    let server: StartedTestServer | undefined;
    // kept rather than read back: restoring an in memory store puts its backup rows back the way they
    // were when the data was taken, which is before this backup was recorded as finished
    let backup: BackupEntity;

    beforeAll(async () => {
        await FsUtilities.rm(backupFolder);
        server = await startTestServer({ dataSources: [EncryptedDataSource] });
        await getNoteRepository().createAll(
            Array.from({ length: NOTE_COUNT }, (_, i) => ({ text: `${MARKER}-${i}-${'a'.repeat(5000)}` }))
        );
        backup = await createBackup('encrypted');
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 30000);

    it('stores nothing of the data readably, and restores all of it', async () => {
        expect((await readFile(getArchivePath(backup))).includes(MARKER)).toBe(false);
        expect(getResource(backup).encryptedKey).toMatch(/^aes-256-gcm\.v1\.mk1\./);

        await getNoteRepository().deleteAll({});
        await getBackupService().restore(backup);

        expect(await getNoteRepository().count()).toBe(NOTE_COUNT);
    }, 15000);

    it('restores a backup taken under a master key that has been replaced, while the old one is listed', async () => {
        assert(server, 'the server did not start');
        await server.reInit({
            providers: withMasterOptions({
                currentMasterStrategy: new AesGcmEncryptionStrategy(),
                currentMasterKey: replacementMasterKey,
                oldMasterKeys: [testMasterKey]
            })
        });

        await getNoteRepository().deleteAll({});
        await getBackupService().restore(backup);

        expect(await getNoteRepository().count()).toBe(NOTE_COUNT);
        // and what is taken from now on is under the replacement
        expect(getResource(await createBackup('after-replacement')).encryptedKey).toMatch(/^aes-256-gcm\.v1\.mk2\./);
    }, 30000);

    it('refuses a backup whose master key is no longer listed, before fetching any of it', async () => {
        assert(server, 'the server did not start');
        await server.reInit({
            providers: withMasterOptions({
                currentMasterStrategy: new AesGcmEncryptionStrategy(),
                currentMasterKey: replacementMasterKey
            })
        });
        const retrieveData: MockInstance<EncryptedFsBackupTransport['retrieveData']> = vi.spyOn(
            EncryptedFsBackupTransport.prototype,
            'retrieveData'
        );

        try {
            await expect(getBackupService().restore(backup)).rejects.toThrow('No master key found with id "mk1"');
            expect(retrieveData).not.toHaveBeenCalled();
        }
        finally {
            retrieveData.mockRestore();
        }
    }, 30000);

    it('refuses an archive whose data was changed, even when its record agrees, and applies none of it', async () => {
        assert(server, 'the server did not start');
        await server.reInit({ providers: defaultTestServerProviders });
        const archive: Buffer = await readFile(getArchivePath(backup));
        // inside the second chunk
        archive.writeUInt8(archive.readUInt8(70_000) ^ 1, 70_000);
        await writeFile(getArchivePath(backup), archive);
        // what somebody who can write to the storage can do as well: the record travels beside the
        // archive, so its checksum is no obstacle to them
        const agreeing: BackupEntity = {
            ...backup,
            resources: [
                {
                    ...getResource(backup),
                    checksum: createHash('sha256').update(archive)
                        .digest('hex'),
                    size: archive.length
                }
            ]
        };
        await getNoteRepository().deleteAll({});
        await getNoteRepository().create({ text: 'current' });

        await expect(getBackupService().restore(agreeing)).rejects.toThrow('could not be decrypted at chunk 1');

        expect((await getNoteRepository().findAll()).map(n => n.text)).toEqual(['current']);
    }, 30000);

    it('reports the backups whose key is still under an old master key', async () => {
        assert(server, 'the server did not start');
        // taken under the test server's own master key, which the reInit below makes an old one
        await server.reInit({ providers: defaultTestServerProviders });
        await createBackup('under-the-old-master');
        await server.reInit({
            providers: withMasterOptions({
                currentMasterStrategy: new AesGcmEncryptionStrategy(),
                currentMasterKey: replacementMasterKey,
                oldMasterKeys: [testMasterKey]
            })
        });

        // this one and the first, whose record the restores above put back as it was before its archive
        // key was written. What it needs was recorded when it was taken, so it is counted all the same
        expect((await inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE).resolveRetiredKeyUsage()).masterKeys).toEqual([{ keyId: testMasterKey.id, dataKeys: 0, backups: 2 }]);
    }, 30000);
});