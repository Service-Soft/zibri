import { beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupService } from './backup.service';
import { POSTGRES_TEST_IMAGE, testFileFolder } from '../__testing__/constants';
import { Backup } from './decorators/backup-resource.decorator';
import { FsBackupTransport } from './transports/fs.backup-transport';
import { PostgresDataSource, PostgresOptions } from '../data-source/data-sources/postgres-data-source.model';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { MigrationEntity } from '../data-source/migration/migration-entity.model';
import { Repository } from '../data-source/repository';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { Newable } from '../types/newable.type';
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
    options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        synchronize: true
    };
    entities: Newable<BaseEntity>[] = [Item, MigrationEntity, BackupResourceEntity, BackupEntity];
}

describe('Create and restore postgres backup', () => {
    let dataSource: DbDataSource;
    let itemRepository: Repository<Item>;
    let backupRepository: Repository<BackupEntity>;
    let container: StartedPostgreSqlContainer;
    let backupService: BackupService;

    beforeAll(async () => {
        await FsUtilities.rm(backupFsFolder);
        container = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
            .withDatabase('db')
            .withUsername('postgres')
            .withPassword('password')
            .start();

        dataSource = inject(DbDataSource);
        dataSource.options = {
            ...dataSource.options,
            port: container.getMappedPort(5432)
        };
        await dataSource.init();
        itemRepository = dataSource.getRepository(Item);
        backupRepository = dataSource.getRepository(BackupEntity);

        // seed one row without `value`
        await itemRepository.create({ value: '42' });

        backupService = inject(BackupService);
        await backupService.onAppInit();
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

    afterAll(async () => {
        await container.stop();
    });
});