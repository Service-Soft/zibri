import { type ProjectCalendarModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { WorkingCalendarChange } from './working-calendar-change.model';
import { WorkingCalendar } from './working-calendar.model';

/**
 * The working calendar of a project or of the tenant, as `GET /:projectId/calendar` and `GET /calendar` of the
 * `ProjectsController` answer it: what it sets itself, and what applies.
 */
export class ProjectCalendar implements ProjectCalendarModel {
    /**
     * The project, or null for the calendar of the tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    projectId!: string | null;

    /**
     * What it sets itself. A null takes the value from above.
     */
    @Property.object({ cls: () => WorkingCalendarChange })
    own!: WorkingCalendarChange;

    /**
     * What applies, with what it takes from above.
     */
    @Property.object({ cls: () => WorkingCalendar })
    effective!: WorkingCalendar;
}
