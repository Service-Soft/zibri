import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PostgresBackupScope } from './postgres-backup-scope.model';
import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';
import { testFileFolder } from '../../../__testing__/constants';
import { queryPostgres } from '../../../__testing__/query-postgres.function';
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
import { FsPath, FsUtilities } from '../../../utilities/fs.utilities';
import { DataSource } from '../../decorators/data-source.decorator';
import { SchemaManagement } from '../../models/schema-management.model';
import { Repository } from '../../repository/repository';
import { RepositoryClass } from '../../repository/repository-class.type';

/**
 * A postgres backup restored by a role of its own rather than the one the application connects with.
 *
 * A file of its own: the data source states its backup role when it is built, and the role is created
 * on the server for this file alone.
 */

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'postgres-backup-role');

/**
 * The role backups run as, which the setup creates as a member of the data source's role.
 */
const BACKUP_ROLE: string = 'separate_backup_role';

@Entity({ tenant: 'shared', allowOrphan: true })
class BackupRoleItem extends BaseEntity {
    @Property.string()
    value!: string;
}

@BackupTransport()
class BackupRoleTransport extends BaseFsBackupTransport {
    override readonly name: string = 'backup-role-transport';
    protected override readonly backupBasePath: FsPath = backupFolder;
}

/**
 * Backs up as a role of its own rather than as the one it connects with.
 */
@DataSource()
@Backup({ transports: [BackupRoleTransport], encrypt: false })
class BackupRoleDataSource extends PostgresDataSource {
    override backupScope: PostgresBackupScope = 'schema';
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };

    override readonly rootUsername: string = BACKUP_ROLE;
    override readonly rootPw: string = 'backup-password';

    entities: Newable<BaseEntity>[] = [
        ...defaultTestServerEntities,
        BackupRoleItem,
        BackupEntity,
        BackupResourceEntity
    ];

    readonly repositories: RepositoryClass[] = defaultTestServerRepositories;

    schemaManagement: SchemaManagement = 'synchronize';

    readonly pooler: PostgresPooler = 'none';
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({ dataSources: [BackupRoleDataSource] });
    // a member of the data source's role, which is what lets it read the schema and give its objects back
    await server.runAsSuperuser(BackupRoleDataSource, [
        `CREATE ROLE ${BACKUP_ROLE} LOGIN PASSWORD 'backup-password' NOSUPERUSER NOCREATEROLE NOCREATEDB`,
        `GRANT postgres TO ${BACKUP_ROLE}`
    ]);
}, 90000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describe('a restore by a separate backup role', () => {
    // restored as the backup role, every table it recreates is the backup role's, and the next migration
    // of the application could not alter them
    it('gives every table back to the application, so its next migration can alter them', async () => {
        const itemRepository: Repository<BackupRoleItem> = inject(repositoryTokenFor(BackupRoleItem));
        const backupRepository: Repository<BackupEntity> = inject(repositoryTokenFor(BackupEntity));
        await itemRepository.create({ value: 'owned' });
        const backupService: BackupService = inject(BackupService);
        await backupService.waitForBackup(await backupService.queueBackup({ name: 'separate-role' }));

        const [backup]: BackupEntity[] = await backupRepository.findAll({ where: { name: 'separate-role' }, relations: ['resources'] });
        assert(backup, 'the backup was not created');
        await inject(BackupService).restore(backup);

        const runSql: (sql: string) => Promise<unknown[]> = async sql => await queryPostgres(inject(BackupRoleDataSource), sql);
        // eslint-disable-next-line cspell/spellchecker
        expect(await runSql('SELECT tableowner FROM pg_tables WHERE tablename = \'backup_role_item\''))
            // eslint-disable-next-line cspell/spellchecker
            .toEqual([{ tableowner: 'postgres' }]);
        await runSql('ALTER TABLE backup_role_item ADD COLUMN migrated text');
        expect((await itemRepository.findAll()).map(i => i.value)).toEqual(['owned']);
    }, 60000);
});