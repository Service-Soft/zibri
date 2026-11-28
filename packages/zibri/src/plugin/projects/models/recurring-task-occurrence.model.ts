import { BaseTenantEntity } from '../../../entity/base-tenant-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { RecurringTask } from './recurring-task.model';

/**
 * An occurrence of a recurring task that was created: the day of the recurrence it is for, and the task created for
 * it. Unique per recurring task and day, which is what creates each occurrence once.
 */
// the record of an occurrence apart from its task, so that deleting the task does not have it created again
@Entity({ allowOrphan: true, uniques: [['recurringTaskId', 'occurrenceOn']] })
export class RecurringTaskOccurrence extends BaseTenantEntity() {
    /**
     * The recurring task.
     */
    @Property.string({ format: 'uuid' })
    recurringTaskId!: string;

    /**
     * The day of the recurrence it is for, before a non-working day moved its due date, at its midnight UTC.
     */
    @Property.date()
    occurrenceOn!: Date;

    /**
     * The task created for it.
     */
    @Property.string({ format: 'uuid' })
    taskId!: string;

    /**
     * When it was created.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;

    /**
     * The recurring task.
     */
    @Property.manyToOne({ target: () => RecurringTask, joinColumn: 'recurringTaskId', inverseSide: 'occurrences' })
    recurringTask?: RecurringTask;
}