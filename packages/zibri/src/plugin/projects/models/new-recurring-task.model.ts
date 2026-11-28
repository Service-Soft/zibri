import { Property } from '../../../entity/decorators/property.decorator';
import { type Timezone, timezoneEnum } from '../../../localization/models/timezone.model';
import { NON_WORKING_DAY_RULE_VALUES, type NonWorkingDayRule } from './non-working-day-rule.model';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';
import { TaskRecurrence } from './task-recurrence.model';

/**
 * A recurring task to create in a project, as `POST /:projectId/recurring-tasks` of the `ProjectsController` and
 * `createRecurringTask` of the recurring task service take it.
 */
export class NewRecurringTask {
    /**
     * The title of each occurrence.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.TITLE_MAX_LENGTH })
    title!: string;

    /**
     * The description of each occurrence, as markdown.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.DESCRIPTION_MAX_LENGTH, required: false })
    description?: string | null;

    /**
     * The users each occurrence is assigned to, each one who sees the project.
     */
    @Property.array({ items: { type: 'string', format: 'uuid' }, required: false })
    assigneeIds?: string[];

    /**
     * The labels of the project each occurrence carries.
     */
    @Property.array({ items: { type: 'string', format: 'uuid' }, required: false })
    labelIds?: string[];

    /**
     * When it is due.
     */
    @Property.object({ cls: () => TaskRecurrence })
    recurrence!: TaskRecurrence;

    /**
     * The first day an occurrence may fall on, such as `2026-07-31`.
     */
    @Property.date()
    startsOn!: Date;

    /**
     * The time zone whose day it is today, which decides when an occurrence is created, such as `Europe/Berlin`.
     */
    @Property.string({ enum: timezoneEnum })
    timezone!: Timezone;

    /**
     * How many days before its due date an occurrence is created. 14 when absent.
     */
    @Property.number({ format: 'integer', min: 0, max: 366, required: false })
    leadTimeInDays?: number;

    /**
     * What happens to a due date on a day that is not a working day. What the calendar of the project says when
     * absent.
     */
    @Property.string({ enum: NON_WORKING_DAY_RULE_VALUES, required: false })
    nonWorkingDay?: NonWorkingDayRule | null;
}
