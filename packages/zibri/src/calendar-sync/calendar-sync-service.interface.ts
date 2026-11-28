import { type CalendarEntryLink } from './calendar-entry-link.model';
import { type CalendarEntrySource } from './calendar-entry-source.model';
import { type CalendarEntry } from './calendar-entry.model';
import { type CalendarSyncTarget } from './calendar-sync-target.model';

/**
 * Interface for the service writing entries of the application into calendars of CalDAV servers, one way: what the
 * application writes replaces what a calendar holds, also when somebody changed the event in the calendar. Each call
 * names its calendar, and a row can be in several. Called in the tenant the rows belong to.
 */
export interface CalendarSyncServiceInterface {
    /**
     * Writes an entry into a calendar: creates its event, or replaces it, and links the row to it.
     * @param entry - The entry.
     * @param target - The calendar.
     * @returns The link of the row to its event in the calendar.
     * @throws {HttpClientError} When the server refuses the event or cannot be reached, such as a
     * `WebDavConflictError` for a calendar that does not exist.
     */
    syncEntry: (entry: CalendarEntry, target: CalendarSyncTarget) => Promise<CalendarEntryLink>,
    /**
     * Removes the entry of a row from a calendar, and its link. Nothing for a row without an entry there.
     * @param source - The row.
     * @param target - The calendar.
     * @throws {HttpClientError} When the server refuses the removal or cannot be reached.
     */
    removeEntry: (source: CalendarEntrySource, target: CalendarSyncTarget) => Promise<void>,
    /**
     * Finds the links of a row to its events, one per calendar it is in.
     * @param source - The row.
     * @returns The links.
     */
    findLinks: (source: CalendarEntrySource) => Promise<CalendarEntryLink[]>
}
