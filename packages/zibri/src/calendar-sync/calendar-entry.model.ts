import { type CalendarEntrySource } from './calendar-entry-source.model';

/**
 * An entry the application writes into a calendar, as an event: what it is synced from, its title, and when it is.
 */
export type CalendarEntry = {
    /**
     * What it is synced from. The event is named `<type>-<id>` in every calendar, and stored as `<type>-<id>.ics`.
     */
    source: CalendarEntrySource,
    /**
     * The title, such as the title of a task.
     */
    summary: string,
    /**
     * What it is about, as plain text, or undefined for nothing.
     */
    description: string | undefined,
    /**
     * The link back to it in the application, an absolute url, or undefined for none. Written as the url of the
     * event and at the end of its description, which calendar apps show as a link.
     */
    url: string | undefined,
    /**
     * When it is, such as when a task is due. Of an entry of a whole day, the day in UTC, such as a `Date` at its
     * midnight UTC.
     */
    start: Date,
    /**
     * Whether it lasts the whole day of `start`. Otherwise it takes place at the moment `start` names.
     */
    allDay: boolean
};
