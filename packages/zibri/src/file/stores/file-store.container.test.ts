import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { BackupTransportTestServerUtilities,
    S3TestServerOptions,
    StartedS3TestServer,
    StartedSftpTestServer } from '../../__testing__/backup/backup-transport-test-server.utilities';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { describeFileStore } from './file-store.cases';
import { FileStoreInterface } from './file-store.interface';
import { S3FileStore } from './s3.file-store';
import { SftpFileStore } from './sftp.file-store';

// against a real S3 compatible service and a real SFTP server, each in a container: what they accept of what the
// stores send, such as the signatures and digests of a bucket and the renames of a server

const USERNAME: string = 'zibri';
const PASSWORD: string = 'zibri-test-password';

const s3Options: S3TestServerOptions = {
    bucket: 'files',
    region: 'us-east-1',
    credentials: { accessKeyId: 'zibri-test', secretAccessKey: 'zibri-test-secret' }
};

let s3: StartedS3TestServer | undefined;
let sftp: StartedSftpTestServer | undefined;
let server: StartedTestServer | undefined;
let s3Store: FileStoreInterface | undefined;
let sftpStore: FileStoreInterface | undefined;

beforeAll(async () => {
    [s3, sftp] = await Promise.all([
        BackupTransportTestServerUtilities.startS3(s3Options),
        BackupTransportTestServerUtilities.startSftp({ username: USERNAME, password: PASSWORD, folder: 'files' })
    ]);
    // the S3 store sends through the application's http client
    server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })] });
    s3Store = new S3FileStore('s3-file-store', {
        endpoint: s3.endpoint,
        bucket: s3Options.bucket,
        region: s3Options.region,
        credentials: s3Options.credentials,
        serverSideEncryption: 'bucket-default',
        prefix: 'app',
        addressingStyle: 'path'
    });
    sftpStore = new SftpFileStore('sftp-file-store', {
        host: sftp.host,
        port: sftp.port,
        username: USERNAME,
        authentication: { password: PASSWORD },
        hostKeyFingerprint: sftp.hostKeyFingerprint,
        // a folder that does not exist yet, so that the first file has to create it
        path: '/files/app'
    });
}, TestTimeouts.inMemory.start + 60000);

afterAll(async () => {
    await server?.shutdown();
    await Promise.all([s3?.container.stop(), sftp?.container.stop()]);
}, TestTimeouts.inMemory.shutdown + 30000);

describeFileStore('S3FileStore against a service in a container', () => {
    if (s3Store == undefined) {
        throw new Error('The bucket did not start.');
    }
    return s3Store;
});

describeFileStore('SftpFileStore against a server in a container', () => {
    if (sftpStore == undefined) {
        throw new Error('The server did not start.');
    }
    return sftpStore;
});