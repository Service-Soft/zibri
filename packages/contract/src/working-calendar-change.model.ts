import { type NonWorkingDayRule } from './non-working-day-rule.model';
import { type ProjectCalendarSyncModel } from './project-calendar-sync.model';

/**
 * A change of the working calendar of a project or of the tenant, as `PATCH /projects/:projectId/calendar` and
 * `PATCH /projects/calendar` take it. Each property is unchanged when absent, and taken from above when null: from the
 * project above, the tenant, or Monday to Friday without holidays, keeping a due date, and no calendar to write the
 * due dates into.
 */
export type WorkingCalendarChangeModel = {
    /**
     * The working weekdays, 0 for Sunday to 6 for Saturday, at least one.
     */
    workingWeekdays?: number[] | null,
    /**
     * The holiday calendar of the application whose holidays are no working days.
     */
    holidayCalendarId?: string | null,
    /**
     * What happens to a due date on a day that is not a working day.
     */
    nonWorkingDay?: NonWorkingDayRule | null,
    /**
     * The calendar the due dates of the tasks are written into, `{ target: null }` for none.
     */
    calendarSync?: ProjectCalendarSyncModel | null
};
