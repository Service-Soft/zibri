import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { StartedWebDavTestServer, WebDavTestServerUtilities } from '../__testing__/web-dav/web-dav-test-server.utilities';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { defineProvider } from '../di/models/di-provider.model';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { WebDavClient } from '../web-dav/web-dav-client';
import { CalendarEntryLink } from './calendar-entry-link.model';
import { describeCalendarSync } from './calendar-sync.service.cases';

// the calendar sync against a real WebDAV server, Apache's mod_dav, in a container: a calendar is a folder there, and
// a put is answered without an ETag. What Nextcloud's CalDAV does is held by calendar-sync.service.nextcloud.test.ts

const connectionId: string = UUIDUtilities.generate();
const tenantId: string = UUIDUtilities.generate();
let server: StartedWebDavTestServer | undefined;
let testServer: StartedTestServer | undefined;

beforeAll(async () => {
    server = await WebDavTestServerUtilities.startApache({ username: 'ada', password: 'Lovelace-1815' });
    testServer = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, CalendarEntryLink], repositories: defaultTestServerRepositories })],
        providers: [
            ...defaultTestServerProviders,
            // the container is reached on this machine, over plain http
            defineProvider({ token: ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS, useValue: { allowedHosts: undefined, allowPrivateNetworks: true } })
        ]
    });
    await testServer.start();
}, Ms.MINUTE * 2);

afterAll(async () => {
    await testServer?.shutdown();
    await server?.stop();
}, TestTimeouts.inMemory.shutdown);

describeCalendarSync('Apache', () => {
    if (server == undefined) {
        throw new Error('The WebDAV server did not start.');
    }
    const calendarApp: WebDavClient = new WebDavClient({ connection: server.connection, network: undefined, timeoutInMs: Ms.SECOND * 30 });
    return {
        connection: { id: connectionId, ...server.connection },
        calendarApp,
        createCalendar: async () => {
            const path: string = `calendars/ada/${UUIDUtilities.generate()}`;
            await calendarApp.createFolder(path);
            return path;
        },
        tenantId
    };
});