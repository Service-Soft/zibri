import { Property } from '../../../entity/decorators/property.decorator';
import { type Timezone, timezoneEnum } from '../../../localization/models/timezone.model';
import { NON_WORKING_DAY_RULE_VALUES, type NonWorkingDayRule } from './non-working-day-rule.model';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';
import { TaskRecurrence } from './task-recurrence.model';

/**
 * A change of a recurring task, as `PATCH /recurring-tasks/:recurringTaskId` of the `ProjectsController` and
 * `updateRecurringTask` of the recurring task service take it. Each property is unchanged when absent. The
 * occurrences created before keep what they were created with.
 */
export class RecurringTaskChange {
    /**
     * The title of each occurrence.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.TITLE_MAX_LENGTH, required: false })
    title?: string;

    /**
     * The description of each occurrence, as markdown, or null for none.
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
     * When it is due. Changing it creates no occurrence due before the day it is changed on.
     */
    @Property.object({ cls: () => TaskRecurrence, required: false })
    recurrence?: TaskRecurrence;

    /**
     * The first day an occurrence may fall on. Changing it creates no occurrence due before the day it is changed on.
     */
    @Property.date({ required: false })
    startsOn?: Date;

    /**
     * The time zone whose day it is today, which decides when an occurrence is created.
     */
    @Property.string({ enum: timezoneEnum, required: false })
    timezone?: Timezone;

    /**
     * How many days before its due date an occurrence is created.
     */
    @Property.number({ format: 'integer', min: 0, max: 366, required: false })
    leadTimeInDays?: number;

    /**
     * What happens to a due date on a day that is not a working day, or null for what the calendar of the project
     * says.
     */
    @Property.string({ enum: NON_WORKING_DAY_RULE_VALUES, required: false })
    nonWorkingDay?: NonWorkingDayRule | null;

    /**
     * True to pause it, false to bring it back. Bringing it back creates no occurrence due while it was paused.
     */
    @Property.boolean({ required: false })
    paused?: boolean;
}