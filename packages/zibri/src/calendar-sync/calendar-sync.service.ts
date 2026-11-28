import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { inject } from '../di/inject.function';
import { Ms } from '../utilities/ms';
import { WebDavClient } from '../web-dav/web-dav-client';
import { WebDavNotFoundError } from '../web-dav/web-dav-not-found.error';
import { WebDavPreconditionFailedError } from '../web-dav/web-dav-precondition-failed.error';
import { WebDavPutOptions } from '../web-dav/web-dav-put-options.model';
import { CalendarEntryLink } from './calendar-entry-link.model';
import { type CalendarEntrySource } from './calendar-entry-source.model';
import { type CalendarEntry } from './calendar-entry.model';
import { type CalendarSyncServiceInterface } from './calendar-sync-service.interface';
import { type CalendarSyncTarget } from './calendar-sync-target.model';
import { ICalendarUtilities } from './i-calendar.utilities';

/**
 * The media type of an event, as CalDAV stores it.
 */
const CALENDAR_CONTENT_TYPE: string = 'text/calendar; charset=utf-8';

/**
 * How long one request to a calendar may take. A CalDAV server checks every event it stores, and a busy Nextcloud
 * takes seconds for that.
 */
const REQUEST_TIMEOUT_IN_MS: number = Ms.SECOND * 30;

/**
 * Default implementation of the calendar sync service: an event per entry, put to `<calendar>/<type>-<id>.ics` under
 * `If-None-Match: *` while the row has no link there and under `If-Match` of the ETag of its link after, each
 * replacing what it finds when the condition does not hold, as the application is what the calendar follows.
 */
@Injectable({ register: 'onUse' })
export class CalendarSyncService implements CalendarSyncServiceInterface {
    // read when used rather than injected: the entity is declared only by an application that syncs
    private get linkRepository(): Repository<CalendarEntryLink> {
        return inject(repositoryTokenFor(CalendarEntryLink));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async syncEntry(entry: CalendarEntry, target: CalendarSyncTarget): Promise<CalendarEntryLink> {
        const client: WebDavClient = this.createClient(target);
        const uid: string = this.resolveUid(entry.source);
        const href: string = this.resolveHref(target, uid);
        const content: string = ICalendarUtilities.writeEvent({
            uid,
            stampedAt: new Date(),
            summary: entry.summary,
            description: [entry.description, entry.url].filter(part => part != undefined && part !== '').join('\n\n') || undefined,
            url: entry.url,
            start: entry.start,
            allDay: entry.allDay
        });
        const link: CalendarEntryLink | undefined = await this.findLink(entry.source, target);
        const condition: WebDavPutOptions = link?.etag == undefined
            ? { contentType: CALENDAR_CONTENT_TYPE, ifNoneMatch: '*' }
            : { contentType: CALENDAR_CONTENT_TYPE, ifMatch: link.etag };
        let etag: string | undefined;
        try {
            etag = await client.put(href, content, condition);
        }
        catch (error) {
            if (!(error instanceof WebDavPreconditionFailedError)) {
                throw error;
            }
            // somebody changed the event in the calendar, or removed it, or it is there from an attempt whose link
            // was never written: the application is what the calendar follows, so it is replaced, and created again
            // where it is gone
            etag = await client.put(href, content, { contentType: CALENDAR_CONTENT_TYPE, overwrite: true });
        }
        // a server that changes what it stores, or Apache, names no ETag in its answer
        etag ??= (await client.findEntry(href))?.etag;
        const data: Pick<CalendarEntryLink, 'href' | 'etag'> = { href, etag: etag ?? null };
        if (link != undefined) {
            return await this.linkRepository.updateById(link.id, data);
        }
        return await this.linkRepository.create({
            sourceType: entry.source.type,
            sourceId: entry.source.id,
            connectionId: target.connection.id,
            calendarPath: target.calendarPath,
            ...data
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeEntry(source: CalendarEntrySource, target: CalendarSyncTarget): Promise<void> {
        const link: CalendarEntryLink | undefined = await this.findLink(source, target);
        if (link == undefined) {
            return;
        }
        try {
            // without a condition: an event somebody changed in the calendar goes as well
            await this.createClient(target).delete(link.href);
        }
        catch (error) {
            // gone already, which is what was asked for
            if (!(error instanceof WebDavNotFoundError)) {
                throw error;
            }
        }
        await this.linkRepository.deleteById(link.id);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findLinks(source: CalendarEntrySource): Promise<CalendarEntryLink[]> {
        return await this.linkRepository.findAll({ where: { sourceType: source.type, sourceId: source.id }, limit: 'all' });
    }

    /**
     * Finds the link of a row to its event in a calendar.
     * @param source - The row.
     * @param target - The calendar.
     * @returns The link, or undefined when the row has no event there.
     */
    private async findLink(source: CalendarEntrySource, target: CalendarSyncTarget): Promise<CalendarEntryLink | undefined> {
        return await this.linkRepository.findOne({
            where: { sourceType: source.type, sourceId: source.id, connectionId: target.connection.id, calendarPath: target.calendarPath },
            required: false
        });
    }

    /**
     * Creates the client of the server of a calendar, its host checked as for a connection of a tenant.
     * @param target - The calendar.
     * @returns The client.
     */
    private createClient(target: CalendarSyncTarget): WebDavClient {
        return WebDavClient.createForTenant(target.connection, { timeoutInMs: REQUEST_TIMEOUT_IN_MS });
    }

    /**
     * Resolves the uid of the event of a row, the same in every calendar and on every version.
     * @param source - The row.
     * @returns The uid.
     */
    private resolveUid(source: CalendarEntrySource): string {
        return `${source.type}-${source.id}`;
    }

    /**
     * Resolves the path of the event of a row below the url of the connection.
     * @param target - The calendar.
     * @param uid - The uid of the event.
     * @returns The path.
     */
    private resolveHref(target: CalendarSyncTarget, uid: string): string {
        // a calendar named with the slash a collection ends in, or with one in front, is the same calendar
        return `${target.calendarPath.replaceAll(/^\/+|\/+$/g, '')}/${uid}.ics`;
    }
}