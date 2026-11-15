import { Readable } from 'node:stream';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { ValKeyBackupMode } from './val-key-backup-mode.model';
import { ValKeyDataSource, ValKeyOptions } from './val-key-data-source.model';
import { ValKeyRestoreMode } from './val-key-restore-mode.model';
import { testFileFolder, TestTimeouts } from '../../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { BackupEntity } from '../../../backup/backup-entity.model';
import { BackupResourceEntity } from '../../../backup/backup-resource-entity.model';
import { BackupServiceInterface } from '../../../backup/backup-service.interface';
import { Backup } from '../../../backup/decorators/backup-resource.decorator';
import { BackupTransport } from '../../../backup/decorators/backup-transport.decorator';
import { FsBackupTransport } from '../../../backup/transports/fs.backup-transport';
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
import { RepositoryClass } from '../../repository/repository-class.type';
import { DataSourceInterface } from '../data-source.interface';

/**
 * Whether a restore of valkey alone keeps a copy of what it holds to put back: not when it is staged and
 * the backup records exactly the migrations of this build, since then nothing changes before its swap and
 * nothing runs after it, and the restore needs half the disk. Always when it is direct, which leaves part of
 * the backup written when it fails part way.
 */

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `val-key-restore-snapshot-${UUIDUtilities.generate()}`);

@BackupTransport()
class SnapshotValKeyTransport extends FsBackupTransport {
    constructor() {
        super('snapshot-val-key-transport', backupFolder);
    }
}

@DataSource()
@Backup({ transports: [SnapshotValKeyTransport], encrypt: false })
class SnapshotValKeyDataSource extends ValKeyDataSource {
    override readonly backupMode: ValKeyBackupMode = 'walk';
    // not readonly, so that a case can restore directly
    override restoreMode: ValKeyRestoreMode = 'staged';

    override options: ValKeyOptions = {
        host: 'localhost',
        // the container serves no tls
        useTLS: false,
        keyPrefix: `snapshot-${UUIDUtilities.generate()}`
    };

    override readonly migrations: Newable<Migration>[] = [CarriedMigration];

    entities: Newable<BaseEntity>[] = [MigrationEntity];

    readonly repositories: RepositoryClass[] = [];

    /**
     * The copies the staging folder held when the last restore applied this data source.
     */
    snapshotsWhileApplying: string[] = [];

    override async restoreBackup(backupData: Readable): Promise<void> {
        this.snapshotsWhileApplying = (await FsUtilities.readdir(inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER)))
            .map(f => f.name)
            .filter(name => name.endsWith('-before'));
        await super.restoreBackup(backupData);
    }
}

@Injectable()
class CarriedMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(SnapshotValKeyDataSource);
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
        super(SnapshotValKeyDataSource);
    }

    override async up(): Promise<void> {
        // nothing to change, it only has to be recorded
    }

    override async down(): Promise<void> {
        // nothing to change back
    }
}

// the records of the backups, beside the data source backed up
const postgresDataSourceClass: Newable<DataSourceInterface> = createTestDataSource({
    entities: [...defaultTestServerEntities, BackupEntity, BackupResourceEntity],
    repositories: defaultTestServerRepositories
});

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

async function takeBackup(): Promise<BackupEntity> {
    return await getBackupService().waitForBackup(await getBackupService().queueBackup({ name: `snapshot-${UUIDUtilities.generate()}` }));
}

async function findRecordedMigrations(): Promise<string[]> {
    return (await inject(SnapshotValKeyDataSource).getRepository(MigrationEntity)
        .findAll()).map(m => m.name);
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({ dataSources: [postgresDataSourceClass, SnapshotValKeyDataSource] });
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describe('the copy a restore of valkey keeps to put back', () => {
    beforeEach(() => {
        inject(SnapshotValKeyDataSource).restoreMode = 'staged';
    });

    it('keeps none when it is staged and the backup records every migration of this build', async () => {
        await getBackupService().restore(await takeBackup());

        expect(inject(SnapshotValKeyDataSource).snapshotsWhileApplying).toStrictEqual([]);
        expect(await findRecordedMigrations()).toContain(CarriedMigration.name);
    }, 60000);

    it('keeps one when it is direct, whatever the backup records', async () => {
        inject(SnapshotValKeyDataSource).restoreMode = 'direct';
        await getBackupService().restore(await takeBackup());

        expect(inject(SnapshotValKeyDataSource).snapshotsWhileApplying).toHaveLength(1);
    }, 60000);

    // last, since it leaves the build carrying the added migration
    it('keeps one, and runs the migration, when this build carries a migration the backup does not record', async () => {
        const backup: BackupEntity = await takeBackup();
        inject(SnapshotValKeyDataSource).migrations.push(AddedMigration);
        await getBackupService().restore(backup);

        expect(inject(SnapshotValKeyDataSource).snapshotsWhileApplying).toHaveLength(1);
        expect(await findRecordedMigrations()).toContain(AddedMigration.name);
    }, 60000);
});