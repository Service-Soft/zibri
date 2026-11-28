/**
 * An event of a calendar, as `ICalendarUtilities.writeEvent` writes it into an iCalendar file (RFC 5545).
 */
export type ICalendarEvent = {
    /**
     * What names the event in every calendar, the same on every version of it, such as `task-<id>`.
     */
    uid: string,
    /**
     * When this version of the event was written.
     */
    stampedAt: Date,
    /**
     * The title.
     */
    summary: string,
    /**
     * What the event is about, as plain text, or undefined for nothing.
     */
    description: string | undefined,
    /**
     * A link that belongs to the event, an absolute url, or undefined for none.
     */
    url: string | undefined,
    /**
     * When the event starts. Of an event that lasts the whole day, the day in UTC, such as a `Date` at its midnight
     * UTC.
     */
    start: Date,
    /**
     * Whether the event lasts the whole day of `start`. Otherwise it takes place at the moment `start` names.
     */
    allDay: boolean
};