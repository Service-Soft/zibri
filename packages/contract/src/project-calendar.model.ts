import { type WorkingCalendarChangeModel } from './working-calendar-change.model';
import { type WorkingCalendarModel } from './working-calendar.model';

/**
 * The working calendar of a project or of the tenant, as `GET /projects/:projectId/calendar` and
 * `GET /projects/calendar` answer it: what it sets itself, and what applies.
 */
export type ProjectCalendarModel = {
    /**
     * The project, or null for the calendar of the tenant.
     */
    projectId: string | null,
    /**
     * What it sets itself. A null takes the value from above.
     */
    own: WorkingCalendarChangeModel,
    /**
     * What applies, with what it takes from above.
     */
    effective: WorkingCalendarModel
};
