import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { BackupEntity } from '../../backup/backup-entity.model';
import { BackupResourceEntity } from '../../backup/backup-resource-entity.model';
import { BackupService } from '../../backup/backup.service';
import { Backup } from '../../backup/decorators/backup-resource.decorator';
import { BackupTransport } from '../../backup/decorators/backup-transport.decorator';
import { BaseFsBackupTransport } from '../../backup/transports/fs.backup-transport';
import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { SchemaManagement } from '../../data-source/models/schema-management.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { testFileFolder } from '../constants';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of what evaluation/01-data-layer.md M55 found about a separate backup role.
 *
 * A file of its own for the reason `backup.evaluation.test.ts` is one: `@DataSource` and `@Backup`
 * register into the static `GlobalRegistry` when the decorator runs, and a data source states its
 * backup role when it is built.
 */

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'evaluation-backup-role');

/**
 * The role backups run as, which the harness creates as a member of the data source's role.
 */
const BACKUP_ROLE: string = 'eval_backup_role';

@Entity({ tenant: 'shared', allowOrphan: true })
class EvalBackupRoleItem extends BaseEntity {
    @Property.string()
    value!: string;
}

@BackupTransport()
class EvalBackupRoleTransport extends BaseFsBackupTransport {
    override readonly name: string = 'eval-backup-role-transport';
    protected override readonly backupBasePath: FsPath = backupFolder;
}

/**
 * Backs up as a role of its own rather than as the one it connects with.
 */
@DataSource()
@Backup({ transports: [EvalBackupRoleTransport], encrypt: false })
class EvalBackupRoleDataSource extends PostgresDataSource {
    override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
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
        EvalBackupRoleItem,
        BackupEntity,
        BackupResourceEntity
    ];

    schemaManagement: SchemaManagement = 'synchronize';
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({ dataSources: [EvalBackupRoleDataSource] });
    // a member of the data source's role, which is what lets it read the schema and give its objects back
    await server.runAsSuperuser(EvalBackupRoleDataSource, [
        `CREATE ROLE ${BACKUP_ROLE} LOGIN PASSWORD 'backup-password' NOSUPERUSER NOCREATEROLE NOCREATEDB`,
        `GRANT postgres TO ${BACKUP_ROLE}`
    ]);
}, 90000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describe('evaluation/01-data-layer M55 - a restore by a separate backup role gives every object back to its owner', () => {
    it('leaves the application owning its tables after a restore, so its next migration can alter them', async () => {
        const itemRepository: Repository<EvalBackupRoleItem> = inject(repositoryTokenFor(EvalBackupRoleItem));
        const backupRepository: Repository<BackupEntity> = inject(repositoryTokenFor(BackupEntity));
        await itemRepository.create({ value: 'owned' });
        await inject(BackupService).createBackup({ name: 'separate-role' });

        const [backup]: BackupEntity[] = await backupRepository.findAll({ where: { name: 'separate-role' }, relations: ['resources'] });
        assert(backup, 'the backup was not created');
        await inject(BackupService).restore(backup);

        // restored as the backup role, every table it recreated was the backup role's
        const runSql: (sql: string) => Promise<unknown[]> = async sql => await inject(EvalBackupRoleDataSource)
            .query(EvalBackupRoleItem).connection.query(sql);
        // eslint-disable-next-line cspell/spellchecker
        expect(await runSql('SELECT tableowner FROM pg_tables WHERE tablename = \'eval_backup_role_item\''))
            // eslint-disable-next-line cspell/spellchecker
            .toEqual([{ tableowner: 'postgres' }]);
        await runSql('ALTER TABLE eval_backup_role_item ADD COLUMN migrated text');
        expect((await itemRepository.findAll()).map(i => i.value)).toEqual(['owned']);
    }, 60000);
});