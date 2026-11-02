import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { first, firstValueFrom } from 'rxjs';
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

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'backups-retention');

@BackupTransport()
class RetentionFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'retention-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = backupFolder;
}

@DataSource()
class RetentionDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

@Backup({ transports: [RetentionFsBackupTransport], encrypt: false })
class ProjectsStore implements BackupResourceInterface {
    createBackupData(): Readable {
        return Readable.from([Buffer.from('every project')]);
    }

    async restoreBackup(): Promise<void> {
        await Promise.resolve();
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({
        dataSources: [RetentionDataSource],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_RETENTION, useValue: { timeZone: 'UTC', last: 2 } })
        ]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.inMemory.shutdown);

/**
 * Takes a backup, and waits until the pass that stored it is over, retention included.
 * @param name - The name of the backup.
 */
async function takeBackup(name: string): Promise<void> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    await backupService.waitForBackup(await backupService.queueBackup({ name }));
    await firstValueFrom(backupService.isCreatingBackup.pipe(first(creating => !creating)));
}

// every backup was kept until the application deleted it
describe('BackupService - a retention', () => {
    it('deletes the backups it keeps no longer once a backup completes, from the transports and the database', async () => {
        await takeBackup('first');
        await takeBackup('second');
        await takeBackup('third');

        const names: string[] = (await inject(repositoryTokenFor(BackupEntity)).findAll({ limit: 'all' })).map(b => b.name);
        expect(names.sort()).toStrictEqual(['second', 'third']);
        expect(await FsUtilities.exists(FsUtilities.getPath(backupFolder, 'first'))).toBe(false);
        expect(await FsUtilities.exists(FsUtilities.getPath(backupFolder, 'second', ProjectsStore.name))).toBe(true);
    }, 20000);
});