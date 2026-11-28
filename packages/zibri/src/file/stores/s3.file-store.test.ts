import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { S3StandIn } from '../../__testing__/backup/s3-stand-in.model';
import { testFileFolder, TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { describeFileStore } from './file-store.cases';
import { S3FileStore } from './s3.file-store';

// against the stand-in, which runs wherever the suites run: what is checked is what the store asks of a bucket.
// What a real service accepts of it is checked against one in file-store.containers.test.ts

const standIn: S3StandIn = new S3StandIn(FsUtilities.getPath(testFileFolder, `s3-file-store-${UUIDUtilities.generate()}`));
let server: StartedTestServer | undefined;

beforeAll(async () => {
    await standIn.start();
    // the store sends through the application's http client
    server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await standIn.stop();
}, TestTimeouts.inMemory.shutdown);

describeFileStore('S3FileStore', () => new S3FileStore('s3-file-store', {
    endpoint: standIn.getEndpoint(),
    bucket: 'files',
    region: 'us-east-1',
    credentials: { accessKeyId: 'stand-in', secretAccessKey: 'stand-in' },
    serverSideEncryption: 'bucket-default',
    prefix: 'app',
    addressingStyle: 'path'
}));