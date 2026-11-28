import { type NonWorkingDayRule } from './non-working-day-rule.model';
import { type TaskRecurrenceModel } from './task-recurrence.model';

/**
 * A task of a project that recurs, as the routes of the projects plugin answer it: the template each of its
 * occurrences is created from, when it is due, and how long before that it is created.
 */
export type RecurringTaskModel = {
    /**
     * The id of the recurring task.
     */
    id: string,
    /**
     * The tenant it belongs to.
     */
    tenantId: string,
    /**
     * The project its occurrences are created in, in the first column whose tasks are not done.
     */
    projectId: string,
    /**
     * The title of each occurrence.
     */
    title: string,
    /**
     * The description of each occurrence, as markdown, or null for none.
     */
    description?: string | null,
    /**
     * The users each occurrence is assigned to, those of them who see the project when it is created.
     */
    assigneeIds: string[],
    /**
     * The labels of the project each occurrence carries.
     */
    labelIds: string[],
    /**
     * When it is due.
     */
    recurrence: TaskRecurrenceModel,
    /**
     * The first day an occurrence may fall on, which the periods are counted from, such as `2026-07-31`.
     */
    startsOn: string,
    /**
     * The time zone whose day it is today, which decides when an occurrence is created, such as `Europe/Berlin`.
     */
    timezone: string,
    /**
     * How many days before its due date an occurrence is created.
     */
    leadTimeInDays: number,
    /**
     * What happens to a due date on a day that is not a working day, or null for what the calendar of the project
     * says.
     */
    nonWorkingDay?: NonWorkingDayRule | null,
    /**
     * When it was paused, or null while it creates its occurrences.
     */
    pausedAt?: string | null,
    /**
     * The first day an occurrence is created for: the day it was created, changed when it was or brought back from a
     * pause. An occurrence due before it is not created.
     */
    activeFrom: string
};
