import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { InMemoryDataSource, testMasterKey } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BackupServiceInterface } from './backup-service.interface';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { BaseFsBackupTransport } from './transports/fs.backup-transport';
import { testFileFolder } from '../__testing__/constants';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { AesGcmEncryptionStrategy } from '../auth/encryption/strategies/aes-gcm.encryption-strategy';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'backups-several-resources');

@BackupTransport()
class SeveralResourcesFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'several-resources-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = backupFolder;
}

@Entity({ tenant: 'shared' })
class Note {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    text!: string;
}

// declared before the settings, so it is the first resource of a backup and the first one a restore
// applies - which is what makes a failure of the second one leave something to undo
@DataSource()
@Backup({ transports: [SeveralResourcesFsBackupTransport], encrypt: false })
class NotesDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Note, BackupEntity, BackupResourceEntity];
}

/**
 * A second resource beside the data source, holding one value, whose next restores can be made to fail
 * the way a resource fails while it applies: after the archive was fetched and checked.
 */
@Backup({ transports: [SeveralResourcesFsBackupTransport], encrypt: false })
class SettingsStore implements BackupResourceInterface {
    value: string = '';

    restoresToFail: number = 0;

    createBackupData(): Readable {
        return Readable.from([Buffer.from(this.value)]);
    }

    async restoreBackup(backupData: Readable): Promise<void> {
        const chunks: Buffer[] = [];
        for await (const chunk of backupData) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        if (this.restoresToFail > 0) {
            this.restoresToFail--;
            throw new Error('the settings could not be applied');
        }
        this.value = Buffer.concat(chunks).toString();
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

function getNoteRepository(): Repository<Note> {
    return inject(repositoryTokenFor(Note));
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

async function getNoteTexts(): Promise<string[]> {
    return (await getNoteRepository().findAll()).map(n => n.text);
}

function getResource(backup: BackupEntity, name: string): BackupResourceEntity {
    const resource: BackupResourceEntity | undefined = backup.resources.find(r => r.name === name);
    assert(resource, `the backup holds no resource "${name}"`);
    return resource;
}

describe('BackupService — a backup of several resources', () => {
    let server: StartedTestServer | undefined;
    // kept rather than read back: restoring the in memory store puts its backup rows back the way they
    // were when the data was taken, which is before this backup was recorded as finished
    let backup: BackupEntity;

    beforeAll(async () => {
        await FsUtilities.rm(backupFolder);
        server = await startTestServer({ dataSources: [NotesDataSource] });
        await getNoteRepository().create({ text: 'backed up' });
        inject(SettingsStore).value = 'backed up';
        await getBackupService().createBackup({ name: 'several' });
        const [created]: BackupEntity[] = await inject(repositoryTokenFor(BackupEntity)).findAll({
            where: { name: 'several' },
            relations: ['resources']
        });
        assert(created, 'the backup was not created');
        backup = created;
    }, 30000);

    beforeEach(async () => {
        await getNoteRepository().deleteAll({});
        await getNoteRepository().create({ text: 'current' });
        inject(SettingsStore).value = 'current';
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        await server?.shutdown();
    }, 30000);

    it('restores every resource', async () => {
        await getBackupService().restore(backup);

        expect(await getNoteTexts()).toEqual(['backed up']);
        expect(inject(SettingsStore).value).toBe('backed up');
    }, 15000);

    it('applies no resource while the archive of another one can still turn out unusable', async () => {
        const archive: FsPath = FsUtilities.getPath(backupFolder, backup.name, getResource(backup, SettingsStore.name).name);
        const original: Buffer = await readFile(archive);
        await writeFile(archive, Buffer.concat([original, Buffer.from('altered')]));
        // the settings archive arrives only once the notes are applied, or after a second when nothing
        // applies them first. Without the wait, a restore that applies each resource as soon as its own
        // archive is checked would still pass whenever the small archive happened to be checked first
        let notesApplied!: () => void;
        const applied: Promise<void> = new Promise(resolve => notesApplied = resolve);
        const restoreNotes: NotesDataSource['restoreBackup'] = NotesDataSource.prototype.restoreBackup;
        jest.spyOn(NotesDataSource.prototype, 'restoreBackup').mockImplementation(async function(this: NotesDataSource, data) {
            await restoreNotes.call(this, data);
            notesApplied();
        });
        const retrieveData: SeveralResourcesFsBackupTransport['retrieveData'] = SeveralResourcesFsBackupTransport.prototype.retrieveData;
        jest.spyOn(SeveralResourcesFsBackupTransport.prototype, 'retrieveData').mockImplementation(
            async function(this: SeveralResourcesFsBackupTransport, b, resource) {
                if (resource.name === SettingsStore.name) {
                    await Promise.race([applied, sleep(1000)]);
                }
                return await retrieveData.call(this, b, resource);
            }
        );

        try {
            await expect(getBackupService().restore(backup)).rejects.toThrow('is not the data backup "several" recorded');
        }
        finally {
            await writeFile(archive, original);
        }

        expect(await getNoteTexts()).toEqual(['current']);
        expect(inject(SettingsStore).value).toBe('current');
    }, 15000);

    it('puts back the resources it already applied when a later one fails to apply', async () => {
        inject(SettingsStore).restoresToFail = 1;

        await expect(getBackupService().restore(backup)).rejects.toThrow('the settings could not be applied');

        expect(await getNoteTexts()).toEqual(['current']);
        expect(inject(SettingsStore).value).toBe('current');
    }, 15000);

    it('names a resource it could not put back, and keeps what that resource held', async () => {
        // the restore and the undo both fail
        inject(SettingsStore).restoresToFail = 2;

        const error: unknown = await getBackupService().restore(backup)
            .catch((error_: unknown) => error_);

        assert(error instanceof Error, 'the restore did not fail');
        expect(error.message).toContain(`"${SettingsStore.name}" could not be put back the way they were`);
        expect(error.cause).toEqual(new Error('the settings could not be applied'));
        const kept: string | undefined = /is kept in (.+)\.$/m.exec(error.message)?.[1];
        assert(kept, 'the error names no file');
        expect(await readFile(kept, 'utf8')).toBe('current');
        // the resources that could be put back are
        expect(await getNoteTexts()).toEqual(['current']);
        await FsUtilities.rm(FsUtilities.getPath(kept));
    }, 15000);

    it('counts an unencrypted backup towards the master key that was current when it was taken', async () => {
        assert(server, 'the server did not start');
        // nothing of the archive is encrypted, but the key rows inside the data are, under the master
        // key of that time - so restoring it needs that key as much as an encrypted one would
        expect(getResource(backup, NotesDataSource.name).encryptedKey).toBeUndefined();
        await server.reInit({
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS,
                    useValue: {
                        currentMasterStrategy: new AesGcmEncryptionStrategy(),
                        currentMasterKey: {
                            id: 'mk2',
                            value: createHash('sha256').update('replacement')
                                .digest()
                        },
                        oldMasterKeys: [testMasterKey]
                    }
                })
            ]
        });

        expect((await inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE).resolveRetiredKeyUsage()).masterKeys).toEqual([{ keyId: testMasterKey.id, dataKeys: 0, backups: 1 }]);
    }, 30000);
});