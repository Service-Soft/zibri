import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { Dirent } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { InMemoryDataSource, testMasterKey } from 'zibri-testing';

import { BackupLayoutTestUtilities } from '../__testing__/backup/backup-layout-test.utilities';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { EncryptionMasterKey, EncryptionMasterOptions } from '../auth/encryption/encryption-master-options.model';
import { AesGcmEncryptionStrategy } from '../auth/encryption/strategies/aes-gcm.encryption-strategy';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Repository } from '../data-source/repository/repository';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider, DiProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupServiceInterface } from './backup-service.interface';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { FsBackupTransport } from './transports/fs.backup-transport';

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
class EncryptedFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('encrypted-fs-backup-transport', backupFolder);
    }
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
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
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
    const backupService: BackupServiceInterface = getBackupService();
    await backupService.waitForBackup(await backupService.queueBackup({ name }));
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

/**
 * Every file the transport holds.
 * @returns Their paths.
 */
async function findStoredFiles(): Promise<FsPath[]> {
    const entries: Dirent[] = await readdir(backupFolder, { recursive: true, withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => FsUtilities.getPath(e.parentPath, e.name));
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
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, 30000);

    it('stores nothing of the data readably, and restores all of it', async () => {
        const files: FsPath[] = await findStoredFiles();
        expect(files.length).toBeGreaterThan(1);
        for (const file of files) {
            expect((await readFile(file)).includes(MARKER)).toBe(false);
        }
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
        // not even a session: fetching starts with one
        const openSession: jest.SpiedFunction<EncryptedFsBackupTransport['openSession']> = jest.spyOn(
            EncryptedFsBackupTransport.prototype,
            'openSession'
        );

        try {
            await expect(getBackupService().restore(backup)).rejects.toThrow('No master key found with id "mk1"');
            expect(openSession).not.toHaveBeenCalled();
        }
        finally {
            openSession.mockRestore();
        }
    }, 30000);

    // what somebody who can write to the storage can do: each chunk is bound to its id, which the record
    // they could change as well does not name
    it('refuses a backup with a chunk changed where it is stored, and applies none of it', async () => {
        assert(server, 'the server did not start');
        await server.reInit({ providers: defaultTestServerProviders });
        // every chunk rather than the first one listed: the folder holds the chunks of the backups taken since
        // as well, and one only they name is one the restore never reads
        const chunkFiles: FsPath[] = (await findStoredFiles()).filter(f => f.startsWith(BackupLayoutTestUtilities.resolveChunksFolder(backupFolder)));
        assert(chunkFiles.length, 'the backup stored no chunk');
        const originals: Buffer[] = await Promise.all(chunkFiles.map(async f => await readFile(f)));
        await Promise.all(chunkFiles.map(async (f, i) => {
            const changed: Buffer = Buffer.from(originals[i] ?? Buffer.alloc(0));
            changed.writeUInt8(changed.readUInt8(100) ^ 1, 100);
            await writeFile(f, changed);
        }));
        await getNoteRepository().deleteAll({});
        await getNoteRepository().create({ text: 'current' });

        try {
            await expect(getBackupService().restore(backup)).rejects.toThrow('is not the chunk it is stored as');
        }
        finally {
            await Promise.all(chunkFiles.map(async (f, i) => await writeFile(f, originals[i] ?? Buffer.alloc(0))));
        }

        expect((await getNoteRepository().findAll()).map(n => n.text)).toEqual(['current']);
    }, 30000);

    it('reports the backups whose key is still under an old master key', async () => {
        assert(server, 'the server did not start');
        // taken under the test server's own master key, which the reInit below makes an old one. The
        // replacement stays listed: the repository key the transport holds was encrypted by it when the
        // backup after the replacement was taken, and a backup needs that key
        await server.reInit({
            providers: withMasterOptions({
                currentMasterStrategy: new AesGcmEncryptionStrategy(),
                currentMasterKey: testMasterKey,
                oldMasterKeys: [replacementMasterKey]
            })
        });
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
        expect((await inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE).resolveRetiredKeyUsage()).masterKeys).toEqual([{ keyId: testMasterKey.id, dataKeys: 0, signingKeys: 0, backups: 2 }]);
    }, 30000);
});