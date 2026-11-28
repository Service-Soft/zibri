import { type NonWorkingDayRule } from './non-working-day-rule.model';
import { type TaskRecurrenceModel } from './task-recurrence.model';

/**
 * A change of a recurring task, as `PATCH /projects/recurring-tasks/:recurringTaskId` takes it. Each property is
 * unchanged when absent. The occurrences created before keep what they were created with.
 */
export type RecurringTaskChangeModel = {
    /**
     * The title of each occurrence.
     */
    title?: string,
    /**
     * The description of each occurrence, as markdown, or null for none.
     */
    description?: string | null,
    /**
     * The users each occurrence is assigned to, each one who sees the project.
     */
    assigneeIds?: string[],
    /**
     * The labels of the project each occurrence carries.
     */
    labelIds?: string[],
    /**
     * When it is due. Changing it creates no occurrence due before the day it is changed on.
     */
    recurrence?: TaskRecurrenceModel,
    /**
     * The first day an occurrence may fall on. Changing it creates no occurrence due before the day it is changed on.
     */
    startsOn?: string,
    /**
     * The time zone whose day it is today, which decides when an occurrence is created.
     */
    timezone?: string,
    /**
     * How many days before its due date an occurrence is created.
     */
    leadTimeInDays?: number,
    /**
     * What happens to a due date on a day that is not a working day, or null for what the calendar of the project
     * says.
     */
    nonWorkingDay?: NonWorkingDayRule | null,
    /**
     * True to pause it, false to bring it back. Bringing it back creates no occurrence due while it was paused.
     */
    paused?: boolean
};