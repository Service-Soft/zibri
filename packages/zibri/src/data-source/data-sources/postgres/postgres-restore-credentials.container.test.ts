import { afterAll, beforeAll } from '@jest/globals';

import { testFileFolder, TestTimeouts } from '../../../__testing__/constants';
import { JwtTestAuthController } from '../../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { describeLoginsAcrossRestore } from '../../../auth/auth.service.restore.cases';
import { FederatedIdentity } from '../../../auth/authenticators/federated/federated-identity.model';
import { OAuthProviderTokens } from '../../../auth/authenticators/oauth/oauth-provider-tokens.model';
import { ApiKeyAuthStrategy } from '../../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../../auth/strategies/api-key/api-key.model';
import { JwtAuthStrategy } from '../../../auth/strategies/jwt/jwt.auth-strategy';
import { BackupEntity } from '../../../backup/backup-entity.model';
import { BackupResourceEntity } from '../../../backup/backup-resource-entity.model';
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
import { PostgresBackupScope } from './postgres-backup-scope.model';
import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';

/**
 * Logging in across a restore of postgres, whose restore of a data source alone changes everything or nothing.
 */

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `postgres-restore-credentials-${UUIDUtilities.generate()}`);

@BackupTransport()
class CredentialsPostgresTransport extends FsBackupTransport {
    constructor() {
        super('credentials-postgres-transport', backupFolder);
    }
}

@DataSource()
@Backup({ transports: [CredentialsPostgresTransport], encrypt: true })
class CredentialsPostgresDataSource extends PostgresDataSource {
    override backupScope: PostgresBackupScope = 'schema';
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };
    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, ApiKey, FederatedIdentity, OAuthProviderTokens, BackupEntity, BackupResourceEntity];
    readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    schemaManagement: SchemaManagement = 'synchronize';
    readonly pooler: PostgresPooler = 'none';
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({
        dataSources: [CredentialsPostgresDataSource],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        controllers: [JwtTestAuthController],
        providers: defaultTestServerProviders
    });
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.postgres.shutdown);

describeLoginsAcrossRestore('postgres', () => server, CredentialsPostgresDataSource);