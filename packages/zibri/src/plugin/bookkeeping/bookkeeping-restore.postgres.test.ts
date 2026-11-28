import { afterAll, beforeAll } from '@jest/globals';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Backup } from '../../backup/decorators/backup-resource.decorator';
import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres/postgres-data-source.model';
import { PostgresPooler } from '../../data-source/data-sources/postgres/postgres-pooler.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { SchemaManagement } from '../../data-source/models/schema-management.model';
import { RepositoryClass } from '../../data-source/repository/repository-class.type';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { FsUtilities } from '../../utilities/fs.utilities';
import { ZibriApprovalPlugin } from '../approval/approval.plugin';
import { ZibriBankPlugin } from '../bank/bank.plugin';
import { ZibriInvoicingPlugin } from '../invoicing/invoicing.plugin';
import { postingTestFileStores, statementsFolder } from './bookkeeping-postings.cases';
import {
    describeRestoreOfBooks,
    restoreBackupFolder,
    RestoreFsBackupTransport,
    restoreStandIn,
    restoreTestEntities,
    restoreTestProviders
} from './bookkeeping-restore.cases';
import { receiptsFolder } from './bookkeeping.cases';
import { ZibriBookkeepingPlugin } from './bookkeeping.plugin';

@DataSource()
@Backup({ transports: [RestoreFsBackupTransport], encrypt: true })
class BooksDataSource extends PostgresDataSource {
    override rootPw: string = 'password';
    override rootUsername: string = 'postgres';
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };
    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, ...restoreTestEntities];
    repositories: RepositoryClass[] = defaultTestServerRepositories;
    schemaManagement: SchemaManagement = 'synchronize';
    readonly pooler: PostgresPooler = 'none';
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await restoreStandIn.start();
    server = await startTestServer({
        fileStores: postingTestFileStores,
        dataSources: [BooksDataSource],
        plugins: [new ZibriBookkeepingPlugin(), new ZibriInvoicingPlugin(), new ZibriApprovalPlugin(), new ZibriBankPlugin()],
        providers: [...defaultTestServerProviders, ...restoreTestProviders]
    });
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
    await restoreStandIn.stop();
    await FsUtilities.rm(receiptsFolder);
    await FsUtilities.rm(statementsFolder);
    await FsUtilities.rm(restoreBackupFolder);
}, TestTimeouts.postgres.shutdown);

describeRestoreOfBooks('postgres');
