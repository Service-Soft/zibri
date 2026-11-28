import { afterAll, beforeAll } from '@jest/globals';

import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { createTestDataSource } from '../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ChainGap } from '../data-source/chain/chain-gap.model';
import { PostgresDataSource } from '../data-source/data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-source/data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../data-source/migration/migration-entity.model';
import { inject } from '../di/inject.function';
import { FileStore } from '../file/decorators/file-store.decorator';
import { FileRecord } from '../file/file-record.model';
import { FsFileStore } from '../file/stores/fs.file-store';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { describeArchive, SecondArchivedReceipt } from './archive.cases';

const documentsFolder: FsPath = FsUtilities.getPath(testFileFolder, `archive-valkey-documents-${UUIDUtilities.generate()}`);
const offsiteFolder: FsPath = FsUtilities.getPath(testFileFolder, `archive-valkey-offsite-${UUIDUtilities.generate()}`);

@FileStore()
class DocumentFileStore extends FsFileStore {
    constructor() {
        super('documents', documentsFolder);
    }
}

@FileStore()
class OffsiteFileStore extends FsFileStore {
    constructor() {
        super('offsite', offsiteFolder);
    }
}

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource();

// the receipts, their files and their gaps in valkey, whose transaction a receipt and its copies are written in. The
// anchors are kept in postgres, beside the encryption keys, which the chain service finds wherever they are
const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, FileRecord, ChainGap, SecondArchivedReceipt]
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        fileStores: [DocumentFileStore, OffsiteFileStore],
        dataSources: [postgresDataSourceClass, valKeyDataSourceClass]
    });
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(documentsFolder);
    await FsUtilities.rm(offsiteFolder);
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeArchive('valkey', SecondArchivedReceipt, () => inject(DocumentFileStore));