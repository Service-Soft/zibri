import { afterAll, beforeAll } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { describeLoginsAcrossRestore } from './auth.service.restore.cases';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { FederatedIdentity } from './authenticators/federated/federated-identity.model';
import { OAuthProviderTokens } from './authenticators/oauth/oauth-provider-tokens.model';
import { ApiKeyAuthStrategy } from './strategies/api-key/api-key.auth-strategy';
import { ApiKey } from './strategies/api-key/api-key.model';
import { JwtAuthStrategy } from './strategies/jwt/jwt.auth-strategy';
import { JwtTestAuthController } from '../__testing__/mocks/controllers/jwt-test-auth.controller';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { BackupEntity } from '../backup/backup-entity.model';
import { BackupResourceEntity } from '../backup/backup-resource-entity.model';
import { Backup } from '../backup/decorators/backup-resource.decorator';
import { BackupTransport } from '../backup/decorators/backup-transport.decorator';
import { FsBackupTransport } from '../backup/transports/fs.backup-transport';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { BaseEntity } from '../entity/base-entity.model';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `auth-restore-${UUIDUtilities.generate()}`);

@BackupTransport()
class AuthRestoreFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('auth-restore-fs-backup-transport', backupFolder);
    }
}

@DataSource()
@Backup({ transports: [AuthRestoreFsBackupTransport], encrypt: true })
class AuthRestoreDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, ApiKey, FederatedIdentity, OAuthProviderTokens, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({
        dataSources: [AuthRestoreDataSource],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        controllers: [JwtTestAuthController],
        providers: defaultTestServerProviders
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.inMemory.shutdown);

describeLoginsAcrossRestore('the in memory data source', () => server, AuthRestoreDataSource);