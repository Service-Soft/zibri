import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { testFileFolder, TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { BackupEntity } from '../../../backup/backup-entity.model';
import { BackupResourceEntity } from '../../../backup/backup-resource-entity.model';
import { BackupServiceInterface } from '../../../backup/backup-service.interface';
import { Backup } from '../../../backup/decorators/backup-resource.decorator';
import { BackupTransport } from '../../../backup/decorators/backup-transport.decorator';
import { FsBackupTransport } from '../../../backup/transports/fs.backup-transport';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Newable } from '../../../types/newable.type';
import { FsPath, FsUtilities } from '../../../utilities/fs.utilities';
import { SemVerVersion } from '../../../utilities/sem-ver.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { DataSource } from '../../decorators/data-source.decorator';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { Migration } from '../../migration/migration.model';
import { SchemaManagement } from '../../models/schema-management.model';
import { Repository } from '../../repository/repository';
import { RepositoryClass } from '../../repository/repository-class.type';
import { PostgresBackupScope } from './postgres-backup-scope.model';
import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';

/**
 * Whether a restore of postgres alone keeps a copy of what it holds to put back: not when the backup
 * records exactly the migrations of this build, since then nothing runs after its one transaction, and
 * the restore needs half the disk.
 */

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `postgres-restore-snapshot-${UUIDUtilities.generate()}`);

@BackupTransport()
class SnapshotPostgresTransport extends FsBackupTransport {
    constructor() {
        super('snapshot-postgres-transport', backupFolder);
    }
}

@DataSource()
@Backup({ transports: [SnapshotPostgresTransport], encrypt: false })
class SnapshotPostgresDataSource extends PostgresDataSource {
    override backupScope: PostgresBackupScope = 'schema';
    // a backup after one in full holds only what changed since, unless a restore came between
    override readonly incrementalRead: boolean = true;
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };

    override readonly migrations: Newable<Migration>[] = [CarriedMigration];

    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];

    readonly repositories: RepositoryClass[] = defaultTestServerRepositories;

    schemaManagement: SchemaManagement = 'synchronize';

    readonly pooler: PostgresPooler = 'none';

    /**
     * The copies the staging folder held when the last restore applied this data source.
     */
    snapshotsWhileApplying: string[] = [];

    override async restoreIncrementalBackup(full: Readable, increments: Readable[]): Promise<void> {
        this.snapshotsWhileApplying = (await FsUtilities.readdir(inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER)))
            .map(f => f.name)
            .filter(name => name.endsWith('-before'));
        await super.restoreIncrementalBackup(full, increments);
    }
}

@Injectable()
class CarriedMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(SnapshotPostgresDataSource);
    }

    override async up(): Promise<void> {
        // nothing to change, it only has to be recorded
    }

    override async down(): Promise<void> {
        // nothing to change back
    }
}

/**
 * A migration this build carries and a backup taken before it was added does not record.
 */
@Injectable()
class AddedMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(SnapshotPostgresDataSource);
    }

    override async up(): Promise<void> {
        // nothing to change, it only has to be recorded
    }

    override async down(): Promise<void> {
        // nothing to change back
    }
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

async function takeBackup(): Promise<BackupEntity> {
    return await getBackupService().waitForBackup(await getBackupService().queueBackup({ name: `snapshot-${UUIDUtilities.generate()}` }));
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({ dataSources: [SnapshotPostgresDataSource] });
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.postgres.shutdown);

describe('the copy a restore of postgres keeps to put back', () => {
    it('keeps none when the backup records every migration of this build', async () => {
        await getBackupService().restore(await takeBackup());

        expect(inject(SnapshotPostgresDataSource).snapshotsWhileApplying).toStrictEqual([]);
    }, 60000);

    it('keeps one, and runs the migration, when this build carries a migration the backup does not record', async () => {
        const backup: BackupEntity = await takeBackup();
        inject(SnapshotPostgresDataSource).migrations.push(AddedMigration);
        await getBackupService().restore(backup);

        expect(inject(SnapshotPostgresDataSource).snapshotsWhileApplying).toHaveLength(1);
        const recorded: string[] = (await inject(repositoryTokenFor(MigrationEntity, SnapshotPostgresDataSource)).findAll()).map(m => m.name);
        expect(recorded).toContain(AddedMigration.name);
    }, 60000);

    it('keeps one when a backup after the one in full records a migration, which changed no table', async () => {
        const migrations: Repository<MigrationEntity> = inject(repositoryTokenFor(MigrationEntity, SnapshotPostgresDataSource));
        const full: BackupEntity = await takeBackup();
        // recorded by a newer build, whose migration changed no table, so the next backup builds on the one in full
        const newer: MigrationEntity = await migrations.create({ name: 'NewerBuildMigration', version: '99.0.0', ranAt: new Date() });
        const increment: BackupEntity = await takeBackup();
        expect(increment.resources[0]?.baseBackupId).toBe(full.id);
        // gone from what is put back, which this build can restore
        await migrations.deleteById(newer.id);

        // the dump records exactly the migrations of this build, and what changed after it one this build lacks
        await expect(getBackupService().restore(increment)).rejects.toThrow('what a newer build stored');

        expect(inject(SnapshotPostgresDataSource).snapshotsWhileApplying).toHaveLength(1);
        expect((await migrations.findAll()).map(m => m.name)).not.toContain('NewerBuildMigration');
    }, 60000);
});