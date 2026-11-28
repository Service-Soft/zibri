import { type ProjectCalendarSyncTargetModel } from './project-calendar-sync-target.model';

/**
 * Which calendar a project or the tenant writes the due dates of its tasks into, as it sets it itself.
 */
export type ProjectCalendarSyncModel = {
    /**
     * The calendar, or null for none: the due dates are written into no calendar.
     */
    target: ProjectCalendarSyncTargetModel | null
};
