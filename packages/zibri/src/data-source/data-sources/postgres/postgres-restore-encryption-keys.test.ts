import { afterAll, beforeAll } from '@jest/globals';

import { PostgresBackupScope } from './postgres-backup-scope.model';
import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';
import { testFileFolder, TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { BackupEntity } from '../../../backup/backup-entity.model';
import { BackupResourceEntity } from '../../../backup/backup-resource-entity.model';
import { describeKeysAcrossRestore, RestoredSecret } from '../../../backup/backup-service.encryption-keys.cases';
import { Backup } from '../../../backup/decorators/backup-resource.decorator';
import { BackupTransport } from '../../../backup/decorators/backup-transport.decorator';
import { FsBackupTransport } from '../../../backup/transports/fs.backup-transport';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Newable } from '../../../types/newable.type';
import { FsPath, FsUtilities } from '../../../utilities/fs.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { DataSource } from '../../decorators/data-source.decorator';
import { SchemaManagement } from '../../models/schema-management.model';
import { RepositoryClass } from '../../repository/repository-class.type';

/**
 * The keys across a restore of postgres, whose foreign keys and uniques are checked as each row is written.
 */

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `postgres-restore-encryption-keys-${UUIDUtilities.generate()}`);

@BackupTransport()
class KeysPostgresTransport extends FsBackupTransport {
    constructor() {
        super('keys-postgres-transport', backupFolder);
    }
}

@DataSource()
@Backup({ transports: [KeysPostgresTransport], encrypt: true })
class KeysPostgresDataSource extends PostgresDataSource {
    override backupScope: PostgresBackupScope = 'schema';
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };
    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, RestoredSecret, BackupEntity, BackupResourceEntity];
    readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    schemaManagement: SchemaManagement = 'synchronize';
    readonly pooler: PostgresPooler = 'none';
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({ dataSources: [KeysPostgresDataSource] });
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.postgres.shutdown);

describeKeysAcrossRestore('postgres', () => server);