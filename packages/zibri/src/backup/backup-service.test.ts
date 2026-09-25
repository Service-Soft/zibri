import assert from 'node:assert';

import { beforeAll, afterAll, describe, it, expect, jest } from '@jest/globals';

import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupService } from './backup.service';
import { testFileFolder } from '../__testing__/constants';
import { Backup } from './decorators/backup-resource.decorator';
import { BaseFsBackupTransport } from './transports/fs.backup-transport';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { PostgresDataSource, PostgresOptions } from '../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { SchemaManagement } from '../data-source/models/schema-management.model';
import { Repository } from '../data-source/repository/repository';
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
import { BackupTransport } from './decorators/backup-transport.decorator';

const backupFsFolder: FsPath = FsUtilities.getPath(testFileFolder, 'backups');

@Entity()
class Item {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    value!: string;
}

@BackupTransport()
class FsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'fs-backup-transport';
    protected override readonly backupBasePath: FsPath = backupFsFolder;
}

@DataSource()
@Backup({
    transports: [FsBackupTransport]
})
class DbDataSource extends PostgresDataSource {
    override rootPw: string = 'password';
    override rootUsername: string = 'postgres';
    override options: OmitStrict<PostgresOptions, 'type'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db'
    };
    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Item, BackupResourceEntity, BackupEntity];
    schemaManagement: SchemaManagement = 'synchronize';
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
        const [backup]: BackupEntity[] = await backupRepository.findAll({ relations: ['resources'] });
        assert(backup, 'no backup was synced');
        await backupService.restore(backup);
        expect((await itemRepository.findAll()).length).toEqual(1);
    }, 15000);

    it('deletes the stored resource file for a given backup', async () => {
        await backupService.createBackup({ name: 'delete-test-backup' });
        const [backup]: BackupEntity[] = await backupRepository.findAll({
            where: { name: 'delete-test-backup' },
            relations: ['resources']
        });
        assert(backup, 'the backup was not created');
        const [resource]: BackupResourceEntity[] = backup.resources;
        assert(resource, 'the backup holds no resources');
        const resourcePath: FsPath = FsUtilities.getPath(backupFsFolder, backup.name, resource.name);
        expect(await FsUtilities.exists(resourcePath)).toBe(true);

        await backupService.delete(backup);

        expect(await FsUtilities.exists(resourcePath)).toBe(false);
    }, 15000);

    it('deletes the whole backup, so that syncing does not bring it back', async () => {
        const backupResourceRepository: Repository<BackupResourceEntity> = inject(repositoryTokenFor(BackupResourceEntity));
        await backupService.createBackup({ name: 'deleted-for-good' });
        const [backup]: BackupEntity[] = await backupRepository.findAll({
            where: { name: 'deleted-for-good' },
            relations: ['resources']
        });
        assert(backup, 'the backup was not created');

        await backupService.delete(backup);

        expect(await FsUtilities.exists(FsUtilities.getPath(backupFsFolder, backup.name, 'metadata.json'))).toBe(false);
        expect(await backupRepository.findAll({ where: { name: 'deleted-for-good' } })).toEqual([]);
        expect(await backupResourceRepository.findAll({ where: { backupId: backup.id } })).toEqual([]);
        await backupService.syncBackupEntities();
        expect(await backupRepository.findAll({ where: { name: 'deleted-for-good' } })).toEqual([]);
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