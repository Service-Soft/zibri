import { type NonWorkingDayRule } from './non-working-day-rule.model';
import { type TaskRecurrenceModel } from './task-recurrence.model';

/**
 * A recurring task to create in a project, as `POST /projects/:projectId/recurring-tasks` takes it.
 */
export type NewRecurringTaskModel = {
    /**
     * The title of each occurrence.
     */
    title: string,
    /**
     * The description of each occurrence, as markdown.
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
     * When it is due.
     */
    recurrence: TaskRecurrenceModel,
    /**
     * The first day an occurrence may fall on, such as `2026-07-31`.
     */
    startsOn: string,
    /**
     * The time zone whose day it is today, which decides when an occurrence is created, such as `Europe/Berlin`.
     */
    timezone: string,
    /**
     * How many days before its due date an occurrence is created. 14 when absent.
     */
    leadTimeInDays?: number,
    /**
     * What happens to a due date on a day that is not a working day. What the calendar of the project says when
     * absent.
     */
    nonWorkingDay?: NonWorkingDayRule | null
};
