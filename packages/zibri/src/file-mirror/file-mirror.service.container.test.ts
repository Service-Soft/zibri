import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { StartedWebDavTestServer, WebDavTestServerUtilities } from '../__testing__/web-dav/web-dav-test-server.utilities';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { TenantWebDavConnection } from '../web-dav/tenant-web-dav-connection.model';
import { WebDavClient } from '../web-dav/web-dav-client';
import { WebDavConnectionKind } from '../web-dav/web-dav-connection-kind.enum';
import { FileMirrorRequest } from './file-mirror-request.model';
import { FileMirrorShareLink } from './file-mirror-share-link.model';
import { describeFileMirror } from './file-mirror.service.cases';
import { MirroredFile } from './mirrored-file.model';

// the file mirror against a real WebDAV server, Apache's mod_dav, in a container, through a connection to any WebDAV
// server: a put is answered without an ETag there, and a file somebody moved is not found again. What Nextcloud does
// is held by file-mirror.service.nextcloud.test.ts

const tenantId: string = UUIDUtilities.generate();
let server: StartedWebDavTestServer | undefined;
let testServer: StartedTestServer | undefined;
let connectionId: string;

beforeAll(async () => {
    server = await WebDavTestServerUtilities.startApache({ username: 'ada', password: 'Lovelace-1815' });
    testServer = await startTestServer({
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, TenantWebDavConnection, MirroredFile, FileMirrorRequest, FileMirrorShareLink],
                repositories: defaultTestServerRepositories
            })
        ],
        providers: [
            ...defaultTestServerProviders,
            // the container is reached on this machine, over plain http
            defineProvider({ token: ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS, useValue: { allowedHosts: undefined, allowPrivateNetworks: true } })
        ]
    });
    await testServer.start();
    const connections: Repository<TenantWebDavConnection> = inject(repositoryTokenFor(TenantWebDavConnection));
    const started: StartedWebDavTestServer = server;
    connectionId = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => (await connections.create({
        name: 'Shared drive',
        kind: WebDavConnectionKind.WEB_DAV,
        ...started.connection
    })).id);
}, TestTimeouts.apache.start + TestTimeouts.inMemory.start);

afterAll(async () => {
    await testServer?.shutdown();
    await server?.stop();
}, TestTimeouts.inMemory.shutdown + TestTimeouts.apache.stop);

describeFileMirror('Apache', () => {
    if (server == undefined) {
        throw new Error('The WebDAV server did not start.');
    }
    return {
        connectionId,
        kind: WebDavConnectionKind.WEB_DAV,
        folderApp: new WebDavClient({ connection: server.connection, network: undefined, timeoutInMs: Ms.SECOND * 30 }),
        root: '',
        tenantId
    };
});