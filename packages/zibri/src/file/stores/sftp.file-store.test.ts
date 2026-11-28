import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { InProcessSftpServer } from '../../__testing__/backup/in-process-sftp-server.model';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { describeFileStore } from './file-store.cases';
import { SftpFileStore } from './sftp.file-store';

// against a server in the test's own process, which runs wherever the suites run. What a real server accepts is
// checked against one in a container in file-store.container.test.ts

const sftp: InProcessSftpServer = new InProcessSftpServer({ 'posix-rename@openssh.com': '1' });
let server: StartedTestServer | undefined;
let store: SftpFileStore | undefined;

beforeAll(async () => {
    await sftp.start();
    // the store warns through the application's logger
    server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })] });
    store = new SftpFileStore('sftp-file-store', sftp.getOptions('/files'));
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await sftp.stop();
}, TestTimeouts.inMemory.shutdown);

describeFileStore('SftpFileStore', () => {
    if (store == undefined) {
        throw new Error('The store was not created.');
    }
    return store;
});