import { beforeEach, describe, expect, it } from '@jest/globals';

import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { type TenantWebDavConnection } from '../web-dav/tenant-web-dav-connection.model';
import { WebDavClient } from '../web-dav/web-dav-client';
import { WebDavDownload } from '../web-dav/web-dav-download.model';
import { type CalendarEntryLink } from './calendar-entry-link.model';
import { type CalendarEntry } from './calendar-entry.model';
import { type CalendarSyncServiceInterface } from './calendar-sync-service.interface';
import { type CalendarSyncTarget } from './calendar-sync-target.model';

/**
 * What the cases of a server need: the connection the service writes through, a client of the same server acting as
 * a calendar app, and the tenant the links are stored in.
 */
export type CalendarSyncCaseServer = {
    /**
     * The connection, as a tenant configured it.
     */
    connection: Pick<TenantWebDavConnection, 'id' | 'url' | 'username' | 'password'>,
    /**
     * A client of the connection, which reads, changes and deletes events as a calendar app does.
     */
    calendarApp: WebDavClient,
    /**
     * Creates a calendar of its own for a case.
     * @returns Its path below the url of the connection.
     */
    createCalendar: () => Promise<string>,
    /**
     * The tenant the service is called in.
     */
    tenantId: string
};

/**
 * Reads what an event holds, unfolded, as a calendar app reads it.
 * @param client - The client of the server.
 * @param href - The path of the event.
 * @returns Its lines.
 */
export async function readEventLines(client: WebDavClient, href: string): Promise<string[]> {
    const download: WebDavDownload = await client.get(href);
    const content: string = Buffer.concat(await download.content.toArray()).toString('utf8');
    return content.replaceAll('\r\n ', '').split('\r\n')
        .filter(line => line !== '');
}

/**
 * The cases every CalDAV server the calendar sync is tested against answers the same.
 * @param name - What the server is, as the suite names it.
 * @param resolveServer - The server, called once it runs.
 */
export function describeCalendarSync(name: string, resolveServer: () => CalendarSyncCaseServer): void {
    describe(`CalendarSyncService against ${name}`, () => {
        let server: CalendarSyncCaseServer;
        let target: CalendarSyncTarget;
        let entry: CalendarEntry;

        /**
         * Calls the service in the tenant of the cases.
         * @param call - What it does with the service.
         * @returns What it resolves to.
         */
        async function inTenant<T>(call: (service: CalendarSyncServiceInterface) => Promise<T>): Promise<T> {
            return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(server.tenantId, async () => await call(inject(ZIBRI_DI_TOKENS.CALENDAR_SYNC_SERVICE)));
        }

        beforeEach(async () => {
            server = resolveServer();
            target = { connection: server.connection, calendarPath: await server.createCalendar() };
            const taskId: string = UUIDUtilities.generate();
            entry = {
                source: { type: 'task', id: taskId },
                summary: 'File the VAT return, Q3',
                description: 'The figures are in the shared folder; ask Ada.',
                url: `https://app.example.com/tasks/${taskId}`,
                start: new Date('2026-07-31T07:00:00.000Z'),
                allDay: false
            };
        });

        it('creates the event of an entry with a link back to it, and the stored link finds the event', async () => {
            const link: CalendarEntryLink = await inTenant(async service => await service.syncEntry(entry, target));

            const lines: string[] = await readEventLines(server.calendarApp, link.href);
            expect(link).toMatchObject({
                sourceType: 'task',
                sourceId: entry.source.id,
                connectionId: server.connection.id,
                calendarPath: target.calendarPath,
                href: `${target.calendarPath}/task-${entry.source.id}.ics`,
                etag: expect.any(String)
            });
            expect(lines).toEqual(expect.arrayContaining([
                'BEGIN:VEVENT',
                `UID:task-${entry.source.id}`,
                'DTSTART:20260731T070000Z',
                'SUMMARY:File the VAT return\\, Q3',
                `DESCRIPTION:The figures are in the shared folder\\; ask Ada.\\n\\nhttps://app.example.com/tasks/${entry.source.id}`,
                `URL:https://app.example.com/tasks/${entry.source.id}`
            ]));
            expect((await server.calendarApp.findEntry(link.href))?.etag).toBe(link.etag);
            expect(await inTenant(async service => await service.findLinks(entry.source))).toEqual([expect.objectContaining({ id: link.id })]);
        });

        it('updates the event when the entry changes, an all day one ending on the next day', async () => {
            const created: CalendarEntryLink = await inTenant(async service => await service.syncEntry(entry, target));

            const updated: CalendarEntryLink = await inTenant(async service => await service.syncEntry(
                { ...entry, summary: 'File the VAT return, Q3 (moved)', start: new Date('2026-08-10T00:00:00.000Z'), allDay: true },
                target
            ));

            const lines: string[] = await readEventLines(server.calendarApp, updated.href);
            expect(updated.id).toBe(created.id);
            expect(updated.etag).not.toBe(created.etag);
            expect(lines).toEqual(expect.arrayContaining([
                'SUMMARY:File the VAT return\\, Q3 (moved)',
                'DTSTART;VALUE=DATE:20260810',
                'DTEND;VALUE=DATE:20260811'
            ]));
            expect(lines.some(line => line.startsWith('DTSTART:'))).toBe(false);
        });

        it('overwrites an event somebody changed in the calendar at the next sync', async () => {
            const created: CalendarEntryLink = await inTenant(async service => await service.syncEntry(entry, target));
            const edited: string = (await readEventLines(server.calendarApp, created.href))
                .map(line => line.startsWith('SUMMARY:') ? 'SUMMARY:Changed in the calendar' : line)
                .join('\r\n');
            await server.calendarApp.put(created.href, `${edited}\r\n`, { contentType: 'text/calendar; charset=utf-8', overwrite: true });

            const synced: CalendarEntryLink = await inTenant(async service => await service.syncEntry(entry, target));

            expect(await readEventLines(server.calendarApp, synced.href)).toContain('SUMMARY:File the VAT return\\, Q3');
            expect(synced.etag).toBe((await server.calendarApp.findEntry(synced.href))?.etag);
        });

        it('creates an event somebody deleted in the calendar again at the next sync', async () => {
            const created: CalendarEntryLink = await inTenant(async service => await service.syncEntry(entry, target));
            await server.calendarApp.delete(created.href);

            const synced: CalendarEntryLink = await inTenant(async service => await service.syncEntry(entry, target));

            expect(await readEventLines(server.calendarApp, synced.href)).toContain(`UID:task-${entry.source.id}`);
        });

        it('removes the event and its link, and removes nothing for an entry without one', async () => {
            const created: CalendarEntryLink = await inTenant(async service => await service.syncEntry(entry, target));

            await inTenant(async service => await service.removeEntry(entry.source, target));
            await inTenant(async service => await service.removeEntry(entry.source, target));

            expect(await server.calendarApp.findEntry(created.href)).toBeUndefined();
            expect(await inTenant(async service => await service.findLinks(entry.source))).toEqual([]);
        });

        it('removes the link of an event somebody deleted in the calendar', async () => {
            const created: CalendarEntryLink = await inTenant(async service => await service.syncEntry(entry, target));
            await server.calendarApp.delete(created.href);

            await inTenant(async service => await service.removeEntry(entry.source, target));

            expect(await inTenant(async service => await service.findLinks(entry.source))).toEqual([]);
        });

        it('keeps an entry in two calendars, each with its own link, and removes it from one alone', async () => {
            const other: CalendarSyncTarget = { connection: server.connection, calendarPath: await server.createCalendar() };
            await inTenant(async service => await service.syncEntry(entry, target));
            const inOther: CalendarEntryLink = await inTenant(async service => await service.syncEntry(entry, other));

            await inTenant(async service => await service.removeEntry(entry.source, target));

            expect(await inTenant(async service => await service.findLinks(entry.source))).toEqual([expect.objectContaining({ calendarPath: other.calendarPath })]);
            expect(await server.calendarApp.findEntry(inOther.href)).toMatchObject({ kind: 'file' });
        });
    });
}
