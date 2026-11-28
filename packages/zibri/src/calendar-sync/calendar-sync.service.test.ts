import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { InProcessWebDavRequest, InProcessWebDavServer } from '../__testing__/web-dav/in-process-web-dav-server.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { HttpStatus } from '../http/http-status.enum';
import { HttpClientError } from '../http-client/http-client.error';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { WebDavClient } from '../web-dav/web-dav-client';
import { WebDavConflictError } from '../web-dav/web-dav-conflict.error';
import { CalendarEntryLink } from './calendar-entry-link.model';
import { type CalendarEntry } from './calendar-entry.model';
import { type CalendarSyncServiceInterface } from './calendar-sync-service.interface';
import { type CalendarSyncTarget } from './calendar-sync-target.model';
import { describeCalendarSync } from './calendar-sync.service.cases';

// what the calendar sync sends and how it reads the answers, against a CalDAV server in this process. What real
// servers do is held by calendar-sync.service.apache.test.ts and calendar-sync.service.nextcloud.test.ts

const calDav: InProcessWebDavServer = new InProcessWebDavServer('ada', 'Lovelace-app-password');
const connectionId: string = UUIDUtilities.generate();
const tenantId: string = UUIDUtilities.generate();
let testServer: StartedTestServer | undefined;

/**
 * Creates a calendar of its own on the server.
 * @returns Its path below the connection.
 */
async function createCalendar(): Promise<string> {
    const path: string = `calendars/ada/${UUIDUtilities.generate()}`;
    calDav.createFolder(path);
    return await Promise.resolve(path);
}

/**
 * Calls the service in the tenant of the suite.
 * @param call - What it does with the service.
 * @returns What it resolves to.
 */
async function inTenant<T>(call: (service: CalendarSyncServiceInterface) => Promise<T>): Promise<T> {
    return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => await call(inject(ZIBRI_DI_TOKENS.CALENDAR_SYNC_SERVICE)));
}

/**
 * What a call ends with.
 * @param call - The call.
 * @returns The error it rejected with, or undefined when it resolved.
 */
async function failureOf(call: Promise<unknown>): Promise<unknown> {
    return await call.then(() => undefined, (error: unknown) => error);
}

/**
 * An entry of a task of its own.
 * @returns The entry.
 */
function createEntry(): CalendarEntry {
    const taskId: string = UUIDUtilities.generate();
    return {
        source: { type: 'task', id: taskId },
        summary: 'Send the offer',
        description: undefined,
        url: `https://app.example.com/tasks/${taskId}`,
        start: new Date('2026-12-01T09:00:00.000Z'),
        allDay: false
    };
}

beforeAll(async () => {
    await calDav.start();
    testServer = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, CalendarEntryLink], repositories: defaultTestServerRepositories })],
        providers: [
            ...defaultTestServerProviders,
            // the server of this process, which a tenant's connection reaches only on a private network
            defineProvider({ token: ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS, useValue: { allowedHosts: ['127.0.0.1'], allowPrivateNetworks: true } })
        ]
    });
    await testServer.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await testServer?.shutdown();
    await calDav.stop();
}, TestTimeouts.inMemory.shutdown);

describeCalendarSync('a CalDAV server in this process', () => ({
    connection: { id: connectionId, ...calDav.connection },
    calendarApp: new WebDavClient({ connection: calDav.connection, network: undefined }),
    createCalendar,
    tenantId
}));

describe('CalendarSyncService, as the requests it sends', () => {
    it('creates an event only where there is none, and replaces it only in the version it wrote', async () => {
        const target: CalendarSyncTarget = { connection: { id: connectionId, ...calDav.connection }, calendarPath: await createCalendar() };
        const entry: CalendarEntry = createEntry();

        const created: CalendarEntryLink = await inTenant(async service => await service.syncEntry(entry, target));
        await inTenant(async service => await service.syncEntry({ ...entry, summary: 'Send the offer again' }, target));

        const puts: InProcessWebDavRequest[] = calDav.requests.filter(request => request.method === 'PUT' && request.path === created.href);
        expect(puts.map(request => [request.ifNoneMatch, request.ifMatch])).toEqual([['*', undefined], [undefined, created.etag]]);
    });

    it('replaces an event changed in the calendar with one put of no condition after the refused one', async () => {
        const target: CalendarSyncTarget = { connection: { id: connectionId, ...calDav.connection }, calendarPath: await createCalendar() };
        const entry: CalendarEntry = createEntry();
        const created: CalendarEntryLink = await inTenant(async service => await service.syncEntry(entry, target));
        calDav.edit(created.href, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
        const before: number = calDav.requests.length;

        const synced: CalendarEntryLink = await inTenant(async service => await service.syncEntry(entry, target));

        expect(calDav.requests.slice(before).map(request => [request.method, request.ifMatch, request.ifNoneMatch])).toEqual([
            ['PUT', created.etag, undefined],
            ['PUT', undefined, undefined]
        ]);
        expect(calDav.files.get(created.href)?.content.toString()).toContain('SUMMARY:Send the offer');
        expect(synced.etag).toBe(calDav.files.get(created.href)?.etag);
    });

    it('reads the ETag of the event from the server when the answer to its put names none', async () => {
        const target: CalendarSyncTarget = { connection: { id: connectionId, ...calDav.connection }, calendarPath: await createCalendar() };
        calDav.namesEtagOnPut = false;
        try {
            const link: CalendarEntryLink = await inTenant(async service => await service.syncEntry(createEntry(), target));

            expect(link.etag).toEqual(expect.any(String));
            expect(link.etag).toBe(calDav.files.get(link.href)?.etag);
        }
        finally {
            calDav.namesEtagOnPut = true;
        }
    });

    it('fails while the server is down, leaving the event and its link as they were', async () => {
        const target: CalendarSyncTarget = { connection: { id: connectionId, ...calDav.connection }, calendarPath: await createCalendar() };
        const entry: CalendarEntry = createEntry();
        const created: CalendarEntryLink = await inTenant(async service => await service.syncEntry(entry, target));
        calDav.down = true;
        let error: unknown;
        try {
            error = await failureOf(inTenant(async service => await service.syncEntry({ ...entry, summary: 'Changed while down' }, target)));
        }
        finally {
            calDav.down = false;
        }

        expect(error).toBeInstanceOf(HttpClientError);
        expect(error).toMatchObject({ responseData: { status: HttpStatus.SERVICE_UNAVAILABLE } });
        expect(await inTenant(async service => await service.findLinks(entry.source))).toEqual([expect.objectContaining({ etag: created.etag })]);
        expect(calDav.files.get(created.href)?.content.toString()).toContain('SUMMARY:Send the offer\r\n');
    });

    it('refuses an entry for a calendar that does not exist', async () => {
        const target: CalendarSyncTarget = { connection: { id: connectionId, ...calDav.connection }, calendarPath: 'calendars/ada/missing' };

        expect(await failureOf(inTenant(async service => await service.syncEntry(createEntry(), target)))).toBeInstanceOf(WebDavConflictError);
    });
});
