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

// the file mirror against Nextcloud in a container, through a connection to a Nextcloud: a file somebody moved is
// found again by its id and written where it is, a file somebody changed is left as it is, and a folder is shared by
// a link. A group of its own, `npm run test:nextcloud`, as the image is half a gigabyte and installs itself on every
// start

const tenantId: string = UUIDUtilities.generate();
let server: StartedWebDavTestServer | undefined;
let testServer: StartedTestServer | undefined;
let connectionId: string;

beforeAll(async () => {
    server = await WebDavTestServerUtilities.startNextcloud({ username: 'ada', password: 'Lovelace-1815-Analytical' });
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
        name: 'Nextcloud',
        kind: WebDavConnectionKind.NEXTCLOUD,
        ...started.connection
    })).id);
}, Ms.MINUTE * 6);

afterAll(async () => {
    await testServer?.shutdown();
    await server?.stop();
}, TestTimeouts.inMemory.shutdown);

describeFileMirror('Nextcloud', () => {
    if (server == undefined) {
        throw new Error('Nextcloud did not start.');
    }
    return {
        connectionId,
        kind: WebDavConnectionKind.NEXTCLOUD,
        folderApp: new WebDavClient({ connection: server.connection, network: undefined, timeoutInMs: Ms.MINUTE }),
        root: '',
        tenantId
    };
});