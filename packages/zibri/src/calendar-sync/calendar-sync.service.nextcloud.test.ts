import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { StartedWebDavTestServer, WebDavTestServerUtilities } from '../__testing__/web-dav/web-dav-test-server.utilities';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { WebDavClient } from '../web-dav/web-dav-client';
import { type WebDavConnection } from '../web-dav/web-dav-connection.model';
import { CalendarEntryLink } from './calendar-entry-link.model';
import { describeCalendarSync } from './calendar-sync.service.cases';

// the calendar sync against the CalDAV server of Nextcloud in a container, which checks every event it stores, keeps
// a calendar apart from the files and answers a calendar query by what an event holds. A group of its own,
// `npm run test:nextcloud`, for the reasons web-dav-client.nextcloud.test.ts names

const ADMIN: string = 'ada';
const connectionId: string = UUIDUtilities.generate();
const tenantId: string = UUIDUtilities.generate();
let server: StartedWebDavTestServer | undefined;
let testServer: StartedTestServer | undefined;

/**
 * The connection of the CalDAV and WebDAV root of the admin, logged in with the app password.
 * @returns The connection.
 */
function resolveConnection(): WebDavConnection {
    if (server == undefined) {
        throw new Error('Nextcloud did not start.');
    }
    return { ...server.connection, url: `${server.origin}/remote.php/dav/` };
}

beforeAll(async () => {
    server = await WebDavTestServerUtilities.startNextcloud({ username: ADMIN, password: 'Lovelace-1815-Analytical' });
    testServer = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, CalendarEntryLink], repositories: defaultTestServerRepositories })],
        providers: [
            ...defaultTestServerProviders,
            // the container is reached on this machine, over plain http
            defineProvider({ token: ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS, useValue: { allowedHosts: undefined, allowPrivateNetworks: true } })
        ]
    });
    await testServer.start();
}, Ms.MINUTE * 6);

afterAll(async () => {
    await testServer?.shutdown();
    await server?.stop();
}, TestTimeouts.inMemory.shutdown);

describeCalendarSync('Nextcloud', () => {
    if (server == undefined) {
        throw new Error('Nextcloud did not start.');
    }
    const started: StartedWebDavTestServer = server;
    return {
        connection: { id: connectionId, ...resolveConnection() },
        calendarApp: new WebDavClient({ connection: resolveConnection(), network: undefined, timeoutInMs: Ms.MINUTE }),
        createCalendar: async () => await WebDavTestServerUtilities.createNextcloudCalendar(started, `projects-${UUIDUtilities.generate()}`),
        tenantId
    };
});

describe('CalendarSyncService against what only Nextcloud does', () => {
    it('stores an event Nextcloud reads as one, which a calendar query of its day finds', async () => {
        if (server == undefined) {
            throw new Error('Nextcloud did not start.');
        }
        const calendarPath: string = await WebDavTestServerUtilities.createNextcloudCalendar(server, `query-${UUIDUtilities.generate()}`);
        const taskId: string = UUIDUtilities.generate();

        const link: CalendarEntryLink = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => await inject(ZIBRI_DI_TOKENS.CALENDAR_SYNC_SERVICE).syncEntry(
            {
                source: { type: 'task', id: taskId },
                summary: 'Jahresabschluss: Unterlagen für Müller & Söhne',
                description: `Alles prüfen ${'und abhaken, '.repeat(20)}`,
                url: `https://app.example.com/tasks/${taskId}`,
                start: new Date('2026-07-31T00:00:00.000Z'),
                allDay: true
            },
            { connection: { id: connectionId, ...resolveConnection() }, calendarPath }
        ));

        // REPORT through fetch, the one request of CalDAV the calendar sync does not send itself
        const credentials: string = Buffer.from(`${server.connection.username}:${server.connection.password}`).toString('base64');
        const response: Response = await fetch(`${server.origin}/remote.php/dav/${calendarPath}/`, {
            method: 'REPORT',
            headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/xml; charset=utf-8', depth: '1' },
            body: '<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
                + '<d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">'
                + '<c:time-range start="20260731T000000Z" end="20260801T000000Z"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>'
        });
        const answer: string = await response.text();

        expect(response.status).toBe(207);
        expect(answer).toContain(`task-${taskId}.ics`);
        expect(answer).toContain('Müller &amp; Söhne');
        expect(answer).toContain(link.etag?.replaceAll('"', '&quot;') ?? 'an etag');
    });
});