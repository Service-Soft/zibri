import { type NonWorkingDayRule } from './non-working-day-rule.model';
import { type ProjectCalendarSyncModel } from './project-calendar-sync.model';

/**
 * A project of a tenant, with its board of columns and tasks, as the routes of the projects plugin answer it. A
 * project can have a parent, to any depth.
 */
export type ProjectModel = {
    /**
     * The id of the project.
     */
    id: string,
    /**
     * The tenant the project belongs to.
     */
    tenantId: string,
    /**
     * The name of the project, such as `Website`.
     */
    name: string,
    /**
     * What the project is about, as markdown, or null for nothing.
     */
    description?: string | null,
    /**
     * The id of the project it is below, or null for a project at the top.
     */
    parentId?: string | null,
    /**
     * When the project was archived, or null for one that is not. A project below an archived one is archived with
     * it.
     */
    archivedAt?: string | null,
    /**
     * The working weekdays of its calendar, 0 for Sunday to 6 for Saturday, or null for those from above.
     */
    workingWeekdays?: number[] | null,
    /**
     * The holiday calendar of its calendar, or null for the one from above.
     */
    holidayCalendarId?: string | null,
    /**
     * What happens to a due date on a day that is not a working day, or null for what is said above.
     */
    nonWorkingDay?: NonWorkingDayRule | null,
    /**
     * The calendar the due dates of its tasks are written into, or null for the one from above.
     */
    calendarSync?: ProjectCalendarSyncModel | null
};