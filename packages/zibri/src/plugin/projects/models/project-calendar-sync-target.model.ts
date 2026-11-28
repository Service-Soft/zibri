import { type ProjectCalendarSyncTargetModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The calendar the due dates of the tasks of a project are written into: a `TenantWebDavConnection` of the tenant,
 * and the path of the calendar below its url.
 */
export class ProjectCalendarSyncTarget implements ProjectCalendarSyncTargetModel {
    /**
     * The id of the `TenantWebDavConnection`.
     */
    @Property.string({ format: 'uuid' })
    connectionId!: string;

    /**
     * The path of the calendar below the url of the connection, such as `calendars/ada/projects` for a connection to
     * `https://cloud.example.com/remote.php/dav/` of Nextcloud.
     */
    @Property.string({ minLength: 1, maxLength: 1000 })
    calendarPath!: string;
}