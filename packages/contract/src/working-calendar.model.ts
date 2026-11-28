import { type NonWorkingDayRule } from './non-working-day-rule.model';
import { type ProjectCalendarSyncTargetModel } from './project-calendar-sync-target.model';

/**
 * The working days the due dates of recurring tasks are kept to, and the calendar the due dates are written into, as
 * they apply to a project.
 */
export type WorkingCalendarModel = {
    /**
     * The working weekdays, 0 for Sunday to 6 for Saturday.
     */
    workingWeekdays: number[],
    /**
     * The holiday calendar of the application whose holidays are no working days, such as `de-by`, or null for none.
     */
    holidayCalendarId: string | null,
    /**
     * What happens to a due date on a day that is not a working day.
     */
    nonWorkingDay: NonWorkingDayRule,
    /**
     * The calendar the due dates of the tasks are written into, or null for none.
     */
    calendarSync: ProjectCalendarSyncTargetModel | null
};
