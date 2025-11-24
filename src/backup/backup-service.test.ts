import { rm } from 'fs/promises';
import path from 'path';

import { beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSourceOptions } from 'typeorm';
import { PostgresConnectionCredentialsOptions } from 'typeorm/driver/postgres/PostgresConnectionCredentialsOptions';

import { BackupService } from './backup.service';
import { POSTGRES_TEST_IMAGE, testFileFolder } from '../__testing__';
import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BaseDataSource } from '../data-source/base-data-source.model';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { MigrationEntity } from '../data-source/migration/migration-entity.model';
import { Repository } from '../data-source/repository';
import { inject, ZIBRI_DI_TOKENS } from '../di';
import { BaseEntity, Entity, Property } from '../entity';
import { Newable } from '../types';
import { Backup } from './decorators/backup-resource.decorator';
import { FsBackupTransport } from './transports';

const backupFsFolder: string = path.join(testFileFolder, 'backups');

@Entity('item')
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
class DbDataSource extends BaseDataSource implements BackupResourceInterface {
    rootPw: string = 'password';
    rootUsername: string = 'postgres';
    options: DataSourceOptions = {
        type: 'postgres',
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
        await rm(backupFsFolder, { recursive: true, force: true });
        container = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
            .withDatabase('db')
            .withUsername('postgres')
            .withPassword('password')
            .start();

        dataSource = inject(DbDataSource);
        (dataSource.options as PostgresConnectionCredentialsOptions) = {
            ...dataSource.options as PostgresConnectionCredentialsOptions,
            port: container.getMappedPort(5432)
        };
        await dataSource.init();
        itemRepository = dataSource.getRepository(Item);
        backupRepository = dataSource.getRepository(BackupEntity);

        // seed one row without `value`
        await itemRepository.create({ value: '42' });

        backupService = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
        await backupService.init();
    }, 15000);

    it('should create and restore a backup', async () => {
        expect((await itemRepository.findAll()).length).toEqual(1);
        await backupService.createBackup();
        expect((await itemRepository.findAll()).length).toEqual(1);
        await itemRepository.deleteAll({});
        expect((await itemRepository.findAll()).length).toEqual(0);
        const backup: BackupEntity = (await backupRepository.findAll({ relations: ['resources'] }))[0];
        await backupService.restore(backup);
        expect((await itemRepository.findAll()).length).toEqual(1);
    }, 15000);

    afterAll(async () => {
        await container.stop();
    });
});