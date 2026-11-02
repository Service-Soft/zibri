import assert from 'node:assert';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BackupServiceInterface } from './backup-service.interface';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { BaseFsBackupTransport } from './transports/fs.backup-transport';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'backups-resource-name');

/**
 * Where a backup named `../escaped` lands, beside the folder the transport keeps its backups in.
 */
const escapedFolder: FsPath = FsUtilities.getPath(testFileFolder, 'escaped');

@BackupTransport()
class ResourceNameFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'resource-name-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = backupFolder;
}

@DataSource()
class ResourceNameDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

@Backup({ name: 'settings', transports: [ResourceNameFsBackupTransport], encrypt: false })
class NamedSettingsStore implements BackupResourceInterface {
    value: string = '';

    createBackupData(): Readable {
        return Readable.from([Buffer.from(this.value)]);
    }

    async restoreBackup(backupData: Readable): Promise<void> {
        const chunks: Buffer[] = [];
        for await (const chunk of backupData) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        this.value = Buffer.concat(chunks).toString();
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

describe('BackupService — a resource with a name of its own', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        await FsUtilities.rm(backupFolder);
        server = await startTestServer({ dataSources: [ResourceNameDataSource] });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        await FsUtilities.rm(backupFolder);
        await FsUtilities.rm(escapedFolder);
    }, 30000);

    // the name is a path segment on every transport, so `../` stored a
    // backup outside the folder the transport was given, and a delete removed it there
    it('refuses a name that is not one segment of a path', async () => {
        const backupService: BackupServiceInterface = getBackupService();

        for (const name of ['../escaped', 'nested/name', 'nested\\name', '..', '.', '']) {
            await expect(backupService.queueBackup({ name })).rejects.toThrow(BadRequestError);
        }
        expect(await FsUtilities.exists(escapedFolder)).toBe(false);
    }, 15000);

    // the same, for the name a record the transports hold carries: a restore and a delete read it
    // from the record, so a record planted with `../` reached outside the folder the same way
    it('leaves out a record a transport holds whose name is not one segment of a path', async () => {
        const backupService: BackupServiceInterface = getBackupService();
        await backupService.waitForBackup(await backupService.queueBackup({ name: 'planted-from' }));
        const record: Record<string, unknown> = JsonUtilities.parse(
            await FsUtilities.readFile(FsUtilities.getPath(backupFolder, 'planted-from', 'metadata.json'))
        );
        await FsUtilities.createFile(
            FsUtilities.getPath(backupFolder, 'planted', 'metadata.json'),
            JsonUtilities.stringify({ ...record, id: UUIDUtilities.generate(), name: '../escaped' })
        );

        await backupService.syncBackupEntities();

        expect(await inject(repositoryTokenFor(BackupEntity)).findAll({ where: { name: '../escaped' } })).toEqual([]);
    }, 15000);

    it('is backed up and restored under that name', async () => {
        inject(NamedSettingsStore).value = 'backed up';
        const backupService: BackupServiceInterface = getBackupService();
        await backupService.waitForBackup(await backupService.queueBackup({ name: 'named' }));
        const [backup]: BackupEntity[] = await inject(repositoryTokenFor(BackupEntity)).findAll({
            where: { name: 'named' },
            relations: ['resources']
        });
        assert(backup, 'the backup was not created');
        expect(backup.resources.map(r => [r.name, r.completed])).toEqual([['settings', true]]);
        inject(NamedSettingsStore).value = 'current';

        await getBackupService().restore(backup);

        expect(inject(NamedSettingsStore).value).toBe('backed up');
    }, 15000);
});