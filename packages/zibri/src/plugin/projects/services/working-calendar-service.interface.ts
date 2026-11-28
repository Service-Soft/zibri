import { type ProjectCalendar } from '../models/project-calendar.model';
import { type WorkingCalendarChange } from '../models/working-calendar-change.model';
import { type WorkingCalendar } from '../models/working-calendar.model';

/**
 * Interface for the service of the working calendars of the projects of the active tenant and of the tenant itself,
 * which the due dates of recurring tasks are kept to.
 */
export interface WorkingCalendarServiceInterface {
    /**
     * Resolves the calendar that applies to a project, past what the caller sees, as work outside a request reads it:
     * each of its values from the project, else from the nearest project above that sets it, else from the tenant,
     * else Monday to Friday without holidays, keeping a due date.
     * @param projectId - The id of the project.
     * @returns The calendar.
     */
    resolveCalendar: (projectId: string) => Promise<WorkingCalendar>,
    /**
     * Resolves which days of a range are working days of a calendar: its working weekdays, without the holidays of
     * its holiday calendar.
     * @param calendar - The calendar.
     * @param from - The first day of the range.
     * @param until - The last day of the range.
     * @returns Whether a day is a working day. A day outside the range is judged by its weekday alone.
     */
    resolveIsWorkingDay: (calendar: WorkingCalendar, from: Date, until: Date) => Promise<(day: Date) => boolean>,
    /**
     * Finds the calendar of a project the caller sees: what it sets, and what applies.
     * @param projectId - The id of the project.
     * @returns The calendar.
     */
    findProjectCalendar: (projectId: string) => Promise<ProjectCalendar>,
    /**
     * Changes the calendar of a project.
     * @param projectId - The id of the project.
     * @param change - What changes.
     * @returns The calendar.
     */
    updateProjectCalendar: (projectId: string, change: WorkingCalendarChange) => Promise<ProjectCalendar>,
    /**
     * Finds the calendar of the tenant, which its projects take what they leave unset from.
     * @returns The calendar.
     */
    findTenantCalendar: () => Promise<ProjectCalendar>,
    /**
     * Changes the calendar of the tenant.
     * @param change - What changes.
     * @returns The calendar.
     */
    updateTenantCalendar: (change: WorkingCalendarChange) => Promise<ProjectCalendar>
}
