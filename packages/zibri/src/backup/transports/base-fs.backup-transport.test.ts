/* eslint-disable typescript/no-deprecated -- the transports of 3.0, which 3.x keeps until 4.0 */
import assert from 'node:assert';
import { chmod } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupLayoutTestUtilities } from '../../__testing__/backup/backup-layout-test.utilities';
import { testFileFolder, TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { Repository } from '../../data-source/repository/repository';
import { RepositoryClass } from '../../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { LoggerInterface } from '../../logging/logger.interface';
import { Newable } from '../../types/newable.type';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { BackupEntity } from '../backup-entity.model';
import { BackupResourceEntity } from '../backup-resource-entity.model';
import { BackupServiceInterface } from '../backup-service.interface';
import { Backup } from '../decorators/backup-resource.decorator';
import { BackupTransport } from '../decorators/backup-transport.decorator';
import { BaseFsBackupTransport } from './base-fs.backup-transport';
import { Format1BackupTransport } from './format-1.backup-transport';
import { FsBackupTransport } from './fs.backup-transport';

const backupsPath: FsPath = FsUtilities.getPath(testFileFolder, 'fs-backup-transport');

@BackupTransport()
class TestFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'fs-backup-transport';
    protected override readonly backupBasePath: FsPath = backupsPath;
}

@DataSource()
@Backup({ transports: [TestFsBackupTransport], encrypt: false })
class BackedUpDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

describe('BaseFsBackupTransport', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        await FsUtilities.rm(backupsPath);
        server = await startTestServer({ dataSources: [BackedUpDataSource] });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server.shutdown();
        await FsUtilities.rm(backupsPath);
    }, 30000);

    it('deletes a backup with its folder, so that syncing warns about nothing', async () => {
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
        const backupRepository: Repository<BackupEntity> = inject(repositoryTokenFor(BackupEntity));
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        await backupService.waitForBackup(await backupService.queueBackup({ name: 'deleted-for-good' }));
        const [backup]: BackupEntity[] = await backupRepository.findAll({ where: { name: 'deleted-for-good' }, relations: ['resources'] });
        assert(backup, 'the backup was not created');
        expect(await FsUtilities.exists(BackupLayoutTestUtilities.resolveBackupFolder(backupsPath, backup))).toBe(true);

        await backupService.delete(backup);
        const warn: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(logger, 'warn');
        try {
            await backupService.syncBackupEntities();

            // left behind, the empty folder read as a backup that was interrupted, on every sync
            expect(await FsUtilities.exists(BackupLayoutTestUtilities.resolveBackupFolder(backupsPath, backup))).toBe(false);
            expect(warn).not.toHaveBeenCalled();
        }
        finally {
            warn.mockRestore();
        }
    });

    // a disk's lost+found, which its root owns and nobody else may read, failed every sync of a transport kept
    // at the top of it, which recorded none of the backups beside it
    it('skips a folder, or a record, it may not read with a warning, and resolves the backups beside it', async () => {
        const storeFolder: FsPath = FsUtilities.getPath(testFileFolder, `fs-backup-transport-denied-${UUIDUtilities.generate()}`);
        const unreadableFolder: FsPath = FsUtilities.getPath(storeFolder, 'lost+found');
        const unreadableRecord: FsPath = FsUtilities.getPath(storeFolder, 'unreadable', 'metadata.json');
        await FsUtilities.createFile(FsUtilities.getPath(storeFolder, 'readable', 'metadata.json'), '{"name":"readable"}');
        await FsUtilities.createFile(FsUtilities.getPath(unreadableFolder, 'anything'), 'anything');
        await FsUtilities.createFile(unreadableRecord, '{"name":"unreadable"}');
        await chmod(unreadableFolder, 0o000);
        await chmod(unreadableRecord, 0o000);
        const transport: Format1BackupTransport = new Format1BackupTransport(new FsBackupTransport('fs-backup-transport', storeFolder));
        const warn: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'warn');
        try {
            expect(await transport.resolveBackups([])).toEqual(['{"name":"readable"}']);
            expect(warn.mock.calls.map(([message]) => message).sort()).toEqual([
                expect.stringContaining('Skipped "lost+found"'),
                expect.stringContaining('Skipped "unreadable"')
            ]);
        }
        finally {
            warn.mockRestore();
            await chmod(unreadableFolder, 0o700);
            await chmod(unreadableRecord, 0o600);
            await FsUtilities.rm(storeFolder);
        }
    });
});