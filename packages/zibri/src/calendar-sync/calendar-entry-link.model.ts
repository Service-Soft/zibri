import { BaseTenantEntity } from '../entity/base-tenant-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';

/**
 * Where the entry of a row is in one calendar: the event, by its path and the ETag of the version written last. One
 * per row and calendar, so that a row can be in several calendars.
 */
// declared only by an application that syncs into calendars
@Entity({ allowOrphan: true, uniques: [['sourceType', 'sourceId', 'connectionId', 'calendarPath']] })
export class CalendarEntryLink extends BaseTenantEntity() {
    /**
     * The kind of row the entry is synced from, such as `task`.
     */
    @Property.string({ maxLength: 100 })
    sourceType!: string;

    /**
     * The id of the row.
     */
    @Property.string({ maxLength: 200 })
    sourceId!: string;

    /**
     * The id of the connection the calendar is reached through, such as of a `TenantWebDavConnection`.
     */
    @Property.string({ maxLength: 200 })
    connectionId!: string;

    /**
     * The path of the calendar below the url of the connection.
     */
    @Property.string({ maxLength: 1000 })
    calendarPath!: string;

    /**
     * The path of the event below the url of the connection, such as `calendars/ada/projects/task-<id>.ics`.
     */
    @Property.string({ maxLength: 1500 })
    href!: string;

    /**
     * The ETag of the version written last, or null when the server named none.
     */
    @Property.string({ maxLength: 500, required: false })
    etag?: string | null;
}
