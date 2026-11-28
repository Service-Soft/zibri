import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { QueuedWorkEntity } from '../../../queue/queued-work-entity.model';
import { TASK_CALENDAR_SYNC_SCOPE_VALUES, type TaskCalendarSyncScope } from './task-calendar-sync-scope.model';

/**
 * A change of tasks, or of the calendar of a project or of the tenant, whose events are not synced yet. Written in
 * the transaction of the change, so that a change rolled back syncs nothing and one committed is synced, retried
 * while the server of a calendar cannot be reached.
 */
// a row per change rather than one per task: the sync reads the task as it is, so rows of one task are done by the
// first that succeeds, which deletes them, and no row can be updated by a change while it runs
@Entity({ allowOrphan: true, defaultOrder: { createdAt: 'ASC' }, indexes: [['nextAttemptAt'], ['scope', 'scopeId']] })
export class TaskCalendarSyncRequest extends QueuedWorkEntity {
    /**
     * The tenant of the change.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * What the change is about.
     */
    @Property.string({ enum: TASK_CALENDAR_SYNC_SCOPE_VALUES })
    scope!: TaskCalendarSyncScope;

    /**
     * The id of the task or of the project, or null for the tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    scopeId?: string | null;

    /**
     * When the change was made.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;
}