import assert from 'node:assert';
import { ChildProcessByStdio, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PostgresBackupScope } from './postgres-backup-scope.model';
import { PostgresDataSource, PostgresOptions } from './postgres-typeorm-data-source.model';
import { testFileFolder } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { BackupEntity } from '../../../backup/backup-entity.model';
import { BackupResourceEntity } from '../../../backup/backup-resource-entity.model';
import { BackupService } from '../../../backup/backup.service';
import { Backup } from '../../../backup/decorators/backup-resource.decorator';
import { BackupTransport } from '../../../backup/decorators/backup-transport.decorator';
import { BaseFsBackupTransport } from '../../../backup/transports/fs.backup-transport';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Newable } from '../../../types/newable.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { FsPath, FsUtilities } from '../../../utilities/fs.utilities';
import { DataSource } from '../../decorators/data-source.decorator';
import { SchemaManagement } from '../../models/schema-management.model';
import { Repository } from '../../repository/repository';
import { RepositoryClass } from '../../repository/repository-class.type';

// evaluation/round-2/02-data-layer-stores.md S1: a backup of the schema takes along whatever else
// lives there - another application's tables, a reporting table - and a restore rolls it back

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'backups-entity-tables');

@Entity({ tenant: 'shared', allowOrphan: true })
class ScopedItem extends BaseEntity {
    @Property.string()
    value!: string;
}

@BackupTransport()
class ScopedFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'scoped-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = backupFolder;
}

@DataSource()
@Backup({ transports: [ScopedFsBackupTransport], encrypt: false })
class ScopedDataSource extends PostgresDataSource {
    // not readonly, so that one case can take it back
    override backupScope: PostgresBackupScope | undefined = 'entity-tables';

    override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };

    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, ScopedItem, BackupEntity, BackupResourceEntity];

    readonly repositories: RepositoryClass[] = defaultTestServerRepositories;

    schemaManagement: SchemaManagement = 'synchronize';
}

let server: StartedTestServer | undefined;
let backupService: BackupService;
let itemRepository: Repository<ScopedItem>;
let backupRepository: Repository<BackupEntity>;

/**
 * Runs a statement as the data source's own role.
 * @param sql - The statement.
 * @returns The rows it returned.
 */
async function runSql<T>(sql: string): Promise<T[]> {
    return await inject(ScopedDataSource).query(ScopedItem).connection.query(sql);
}

/**
 * Reads back what a backup wrote, as the statements its archive holds.
 * @param backupName - The name the backup was created under.
 * @returns The statements.
 */
async function readStoredDump(backupName: string): Promise<string> {
    const child: ChildProcessByStdio<null, Readable, null> = spawn(
        'pg_restore',
        ['--file', '-', FsUtilities.getPath(backupFolder, backupName, ScopedDataSource.name)],
        { stdio: ['ignore', 'pipe', 'inherit'] }
    );
    return await text(child.stdout);
}

/**
 * Finds the backup of the given name, with what a restore of it needs.
 * @param name - The name the backup was created under.
 * @returns The backup.
 */
async function findBackup(name: string): Promise<BackupEntity> {
    const [backup]: BackupEntity[] = await backupRepository.findAll({ where: { name }, relations: ['resources'] });
    assert(backup, `the backup "${name}" was not created`);
    return backup;
}

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({ dataSources: [ScopedDataSource] });
    itemRepository = inject(repositoryTokenFor(ScopedItem));
    backupRepository = inject(repositoryTokenFor(BackupEntity));
    backupService = inject(BackupService);
}, 90000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 30000);

describe('a postgres backup of the entity tables', () => {
    it('restores the rows of the entity tables', async () => {
        await itemRepository.deleteAll({});
        await itemRepository.create({ value: 'backed up' });
        await backupService.createBackup({ name: 'rows' });
        await itemRepository.deleteAll({});

        await backupService.restore(await findBackup('rows'));

        expect((await itemRepository.findAll()).map(i => i.value)).toEqual(['backed up']);
    }, 60000);

    it('leaves a table no entity declares out of the backup, and alone in a restore', async () => {
        await runSql('CREATE TABLE scoped_foreign (entry text)');
        await runSql('INSERT INTO scoped_foreign VALUES (\'before\')');
        await backupService.createBackup({ name: 'foreign' });
        await runSql('UPDATE scoped_foreign SET entry = \'after\'');
        await runSql('CREATE TABLE scoped_foreign_later (entry text)');

        await backupService.restore(await findBackup('foreign'));

        expect(await runSql('SELECT entry FROM scoped_foreign')).toEqual([{ entry: 'after' }]);
        expect(await runSql('SELECT to_regclass(\'scoped_foreign_later\')::text AS later')).toEqual([{ later: 'scoped_foreign_later' }]);
        expect(await readStoredDump('foreign')).not.toMatch(/scoped_foreign/);
        await runSql('DROP TABLE scoped_foreign, scoped_foreign_later');
    }, 60000);

    it('refuses, and changes nothing, when something outside the entity tables depends on one of them', async () => {
        await itemRepository.deleteAll({});
        await itemRepository.create({ value: 'backed up' });
        await backupService.createBackup({ name: 'depended-on' });
        await itemRepository.deleteAll({});
        await itemRepository.create({ value: 'current' });
        // a reporting view somebody else keeps, which a restore would otherwise drop and never bring back
        await runSql('CREATE VIEW scoped_report AS SELECT value FROM scoped_item');

        await expect(backupService.restore(await findBackup('depended-on'))).rejects.toThrow();

        expect((await itemRepository.findAll()).map(i => i.value)).toEqual(['current']);
        expect(await runSql('SELECT value FROM scoped_report')).toEqual([{ value: 'current' }]);
        await runSql('DROP VIEW scoped_report');
    }, 60000);

    it('refuses to start a backed up data source that does not say what its backup covers', async () => {
        const dataSource: ScopedDataSource = inject(ScopedDataSource);
        dataSource.backupScope = undefined;
        try {
            await expect(dataSource.validateBackupConfiguration()).rejects.toThrow(
                'Invalid data source marked with @Backup: backupScope is not set.'
            );
        }
        finally {
            dataSource.backupScope = 'entity-tables';
        }
    }, 60000);
});