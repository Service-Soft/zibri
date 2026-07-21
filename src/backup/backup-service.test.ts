import { beforeAll, afterAll, describe, it, expect, jest } from '@jest/globals';

import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupService } from './backup.service';
import { testFileFolder } from '../__testing__/constants';
import { Backup } from './decorators/backup-resource.decorator';
import { FsBackupTransport } from './transports/fs.backup-transport';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { PostgresDataSource, PostgresOptions } from '../data-source/data-sources/postgres-typeorm-data-source.model';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Repository } from '../data-source/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { LoggerInterface } from '../logging/logger.interface';
import { Newable } from '../types/newable.type';
import { OmitStrict } from '../types/omit-strict.type';
import { FsUtilities, FsPath } from '../utilities/fs.utilities';

const backupFsFolder: FsPath = FsUtilities.getPath(testFileFolder, 'backups');

@Entity()
class Item {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    value!: string;
}

@DataSource()
@Backup({
    transports: [
        new FsBackupTransport(
            'fs-backup-transport',
            backupFsFolder
        )
    ]
})
class DbDataSource extends PostgresDataSource {
    rootPw: string = 'password';
    rootUsername: string = 'postgres';
    options: OmitStrict<PostgresOptions, 'type'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        synchronize: true
    };
    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Item, BackupResourceEntity, BackupEntity];
}

describe('Create and restore postgres backup', () => {
    let server: StartedTestServer;
    let backupService: BackupService;
    let itemRepository: Repository<Item>;
    let backupRepository: Repository<BackupEntity>;

    beforeAll(async () => {
        await FsUtilities.rm(backupFsFolder);
        server = await startTestServer({ dataSources: [DbDataSource] });
        itemRepository = inject(repositoryTokenFor(Item));
        backupRepository = inject(repositoryTokenFor(BackupEntity));
        backupService = inject(BackupService);

        // seed one row without `value`
        await itemRepository.create({ value: '42' });
    }, 15000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    it('should create and restore a backup', async () => {
        expect((await itemRepository.findAll()).length).toEqual(1);
        await backupService.createBackup();
        expect((await itemRepository.findAll()).length).toEqual(1);
        await itemRepository.deleteAll({});
        expect((await itemRepository.findAll()).length).toEqual(0);
        await backupRepository.deleteAll({});
        expect((await backupRepository.findAll()).length).toEqual(0);
        await backupService.syncBackupEntities();
        expect((await backupRepository.findAll()).length).toEqual(1);
        const backup: BackupEntity = (await backupRepository.findAll({ relations: ['resources'] }))[0];
        await backupService.restore(backup);
        expect((await itemRepository.findAll()).length).toEqual(1);
    }, 15000);

    it('deletes the stored resource file for a given backup', async () => {
        await backupService.createBackup({ name: 'delete-test-backup' });
        const backup: BackupEntity = (await backupRepository.findAll({
            where: { name: 'delete-test-backup' },
            relations: ['resources']
        }))[0];
        const resource: BackupResourceEntity = backup.resources[0];
        const resourcePath: FsPath = FsUtilities.getPath(backupFsFolder, backup.name, resource.name);
        expect(await FsUtilities.exists(resourcePath)).toBe(true);

        await backupService.delete(backup);

        expect(await FsUtilities.exists(resourcePath)).toBe(false);
    }, 15000);

    it('warns and skips a backup directory that is missing its metadata file', async () => {
        const orphanBackupName: string = 'orphan-without-metadata';
        await FsUtilities.mkdir(FsUtilities.getPath(backupFsFolder, orphanBackupName));

        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        // eslint-disable-next-line typescript/typedef
        const warnSpy = jest.spyOn(logger, 'warn');

        await backupService.syncBackupEntities();

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Could not find the metadata file needed to resolve a backup')
        );
        expect(await backupRepository.findAll({ where: { name: orphanBackupName } })).toHaveLength(0);

        warnSpy.mockRestore();
    }, 15000);
});