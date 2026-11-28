import { BaseTenantEntity } from '../../../entity/base-tenant-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { type Timezone, timezoneEnum } from '../../../localization/models/timezone.model';
import { NON_WORKING_DAY_RULE_VALUES, type NonWorkingDayRule } from './non-working-day-rule.model';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';
import { Project } from './project.model';
import { RecurringTaskOccurrence } from './recurring-task-occurrence.model';
import { TaskRecurrence } from './task-recurrence.model';

/**
 * A task of a project that recurs: the template each occurrence is created from, as a task in the first column of
 * the board whose tasks are not done, when it is due, and how many days before that it is created. Seen by whoever
 * sees the project.
 */
@Entity({ allowOrphan: true, sharedThrough: 'project', indexes: [['projectId']] })
export class RecurringTask extends BaseTenantEntity() {
    /**
     * The project its occurrences are created in.
     */
    @Property.string({ format: 'uuid' })
    projectId!: string;

    /**
     * The title of each occurrence.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.TITLE_MAX_LENGTH })
    title!: string;

    /**
     * The description of each occurrence, as markdown, or null for none.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.DESCRIPTION_MAX_LENGTH, required: false })
    description?: string | null;

    /**
     * The users each occurrence is assigned to, those of them who see the project when it is created.
     */
    @Property.array({ items: { type: 'string', format: 'uuid' } })
    assigneeIds!: string[];

    /**
     * The labels of the project each occurrence carries, those of them that are still there.
     */
    @Property.array({ items: { type: 'string', format: 'uuid' } })
    labelIds!: string[];

    /**
     * When it is due.
     */
    @Property.object({ cls: () => TaskRecurrence })
    recurrence!: TaskRecurrence;

    /**
     * The first day an occurrence may fall on, which the periods are counted from, at its midnight UTC.
     */
    @Property.date()
    startsOn!: Date;

    /**
     * The time zone whose day it is today, which decides when an occurrence is created, such as `Europe/Berlin`.
     */
    @Property.string({ enum: timezoneEnum })
    timezone!: Timezone;

    /**
     * How many days before its due date an occurrence is created.
     */
    @Property.number({ format: 'integer', min: 0, max: 366 })
    leadTimeInDays!: number;

    /**
     * What happens to a due date on a day that is not a working day, or null for what the calendar of the project
     * says.
     */
    @Property.string({ enum: NON_WORKING_DAY_RULE_VALUES, required: false })
    nonWorkingDay?: NonWorkingDayRule | null;

    /**
     * When it was paused, or null while it creates its occurrences.
     */
    @Property.date({ required: false })
    pausedAt?: Date | null;

    /**
     * The first day an occurrence is created for, at its midnight UTC: the day it was created, its recurrence or
     * start was changed, or it was brought back from a pause.
     */
    @Property.date()
    activeFrom!: Date;

    /**
     * The project its occurrences are created in.
     */
    @Property.manyToOne({ target: () => Project, joinColumn: 'projectId', inverseSide: 'recurringTasks' })
    project?: Project;

    /**
     * The occurrences created, by the day each is for.
     */
    @Property.oneToMany({ target: () => RecurringTaskOccurrence, inverseSide: 'recurringTask', required: false })
    occurrences?: RecurringTaskOccurrence[];
}
