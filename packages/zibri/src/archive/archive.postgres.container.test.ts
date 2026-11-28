import { afterAll, beforeAll } from '@jest/globals';

import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ChainGap } from '../data-source/chain/chain-gap.model';
import { PostgresDataSource } from '../data-source/data-sources/postgres/postgres-data-source.model';
import { inject } from '../di/inject.function';
import { FileStore } from '../file/decorators/file-store.decorator';
import { FileRecord } from '../file/file-record.model';
import { FsFileStore } from '../file/stores/fs.file-store';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { ArchivedReceipt, describeArchive } from './archive.cases';

const documentsFolder: FsPath = FsUtilities.getPath(testFileFolder, `archive-postgres-documents-${UUIDUtilities.generate()}`);
const offsiteFolder: FsPath = FsUtilities.getPath(testFileFolder, `archive-postgres-offsite-${UUIDUtilities.generate()}`);

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

// the receipts, their files and their gaps in one data source, whose transaction a receipt and its copies are written in
const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, FileRecord, ChainGap, ArchivedReceipt],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ fileStores: [DocumentFileStore, OffsiteFileStore], dataSources: [dataSourceClass] });
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(documentsFolder);
    await FsUtilities.rm(offsiteFolder);
}, TestTimeouts.postgres.shutdown);

describeArchive('postgres', ArchivedReceipt, () => inject(DocumentFileStore));