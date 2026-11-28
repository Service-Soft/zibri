import { type TenantWebDavConnection } from '../web-dav/tenant-web-dav-connection.model';

/**
 * A calendar entries are written into: a calendar of a CalDAV server, such as Nextcloud, and the connection it is
 * reached through.
 */
export type CalendarSyncTarget = {
    /**
     * The connection, such as a `TenantWebDavConnection` as a repository reads it, its password decrypted. Its hosts
     * are checked as `WebDavClient.createForTenant` checks them, and the links of the entries are stored under its
     * `id`.
     */
    connection: Pick<TenantWebDavConnection, 'id' | 'url' | 'username' | 'password'>,
    /**
     * The path of the calendar below the url of the connection, such as `calendars/ada/projects` for the calendar
     * `projects` of Ada on Nextcloud, whose connection is `https://cloud.example.com/remote.php/dav/`.
     */
    calendarPath: string
};