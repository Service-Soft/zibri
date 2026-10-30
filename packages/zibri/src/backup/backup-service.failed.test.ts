import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { first, firstValueFrom } from 'rxjs';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BackupServiceInterface } from './backup-service.interface';
import { BackupStatus } from './backup-status.enum';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { BaseFsBackupTransport } from './transports/fs.backup-transport';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';

const reachableFolder: FsPath = FsUtilities.getPath(testFileFolder, 'backups-failed-reachable');
const failingFolder: FsPath = FsUtilities.getPath(testFileFolder, 'backups-failed-failing');

@BackupTransport()
class ReachableFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'reachable-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = reachableFolder;
}

/**
 * A transport whose server goes away partway through every upload, leaving what it received.
 */
@BackupTransport()
class FailingFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'failing-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = failingFolder;

    override async storeData(data: Readable, backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        await super.storeData(Readable.from([Buffer.from('the first half')]), backup, resource);
        data.destroy();
        throw new Error('the backup server went away');
    }
}

@DataSource()
class FailedBackupDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * A resource holding one value.
 */
abstract class ValueStore implements BackupResourceInterface {
    createBackupData(): Readable {
        return Readable.from([Buffer.from('every row')]);
    }

    async restoreBackup(): Promise<void> {
        await Promise.resolve();
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

@Backup({ transports: [ReachableFsBackupTransport], encrypt: false })
class ProjectsStore extends ValueStore {}

@Backup({ transports: [FailingFsBackupTransport], encrypt: false })
class TasksStore extends ValueStore {}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(reachableFolder);
    await FsUtilities.rm(failingFolder);
    server = await startTestServer({
        dataSources: [FailedBackupDataSource],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_MAX_ATTEMPTS, useValue: 1 })
        ]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(reachableFolder);
    await FsUtilities.rm(failingFolder);
}, TestTimeouts.inMemory.shutdown);

// part of evaluation round 2, 02 §S16: a failed backup left what it had stored on the transports,
// where nothing would ever restore it, until somebody deleted the backup
describe('BackupService - a backup that failed', () => {
    it('removes what it stored from every transport, and keeps its record with why it failed', async () => {
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
        const queued: BackupEntity = await backupService.queueBackup({ name: 'failed' });

        await expect(backupService.waitForBackup(queued)).rejects.toThrow('the backup server went away');
        // the pass storing the other resource, which may end after the backup failed
        await firstValueFrom(backupService.isCreatingBackup.pipe(first(creating => !creating)));

        expect(await FsUtilities.exists(FsUtilities.getPath(reachableFolder, 'failed', ProjectsStore.name))).toBe(false);
        expect(await FsUtilities.exists(FsUtilities.getPath(failingFolder, 'failed', TasksStore.name))).toBe(false);
        const failed: BackupEntity = await inject(repositoryTokenFor(BackupEntity)).findById(queued.id, { relations: ['resources'] });
        expect(failed.status).toBe(BackupStatus.FAILED);
        expect(failed.resources.find(r => r.name === TasksStore.name)?.error?.paragraphs.join('\n')).toContain('the backup server went away');

        await backupService.delete(failed);
        expect(await inject(repositoryTokenFor(BackupEntity)).findAll({ where: { id: queued.id } })).toStrictEqual([]);
    }, 20000);
});