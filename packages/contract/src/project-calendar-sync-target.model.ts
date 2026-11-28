/**
 * The calendar the due dates of the tasks of a project are written into: a WebDAV connection of the tenant, and the
 * path of the calendar below its url.
 */
export type ProjectCalendarSyncTargetModel = {
    /**
     * The id of the WebDAV connection of the tenant.
     */
    connectionId: string,
    /**
     * The path of the calendar below the url of the connection, such as `calendars/ada/projects`.
     */
    calendarPath: string
};
