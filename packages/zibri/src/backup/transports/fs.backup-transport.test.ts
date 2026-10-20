import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it, vi, MockInstance } from 'vitest';
import { InMemoryDataSource } from 'zibri-testing';

import { BaseFsBackupTransport } from './fs.backup-transport.ts';
import { testFileFolder } from '../../__testing__/constants.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { DataSource } from '../../data-source/decorators/data-source.decorator.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { LoggerInterface } from '../../logging/logger.interface.ts';
import { Newable } from '../../types/newable.type.ts';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities.ts';
import { BackupEntity } from '../backup-entity.model.ts';
import { BackupResourceEntity } from '../backup-resource-entity.model.ts';
import { BackupServiceInterface } from '../backup-service.interface.ts';
import { Backup } from '../decorators/backup-resource.decorator.ts';
import { BackupTransport } from '../decorators/backup-transport.decorator.ts';

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
}

describe('BaseFsBackupTransport', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [BackedUpDataSource] });
    }, 30000);

    afterAll(async () => {
        await server.shutdown();
        await FsUtilities.rm(backupsPath);
    }, 30000);

    it('deletes a backup with its folder, so that syncing warns about nothing', async () => {
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
        const backupRepository: Repository<BackupEntity> = inject(repositoryTokenFor(BackupEntity));
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        await backupService.createBackup({ name: 'deleted-for-good' });
        const [backup]: BackupEntity[] = await backupRepository.findAll({ where: { name: 'deleted-for-good' }, relations: ['resources'] });
        assert(backup, 'the backup was not created');
        expect(await FsUtilities.exists(FsUtilities.getPath(backupsPath, 'deleted-for-good'))).toBe(true);

        await backupService.delete(backup);
        const warn: MockInstance<LoggerInterface['warn']> = vi.spyOn(logger, 'warn');
        try {
            await backupService.syncBackupEntities();

            // left behind, the empty folder read as a backup that was interrupted, on every sync
            expect(await FsUtilities.exists(FsUtilities.getPath(backupsPath, 'deleted-for-good'))).toBe(false);
            expect(warn).not.toHaveBeenCalled();
        }
        finally {
            warn.mockRestore();
        }
    });
});