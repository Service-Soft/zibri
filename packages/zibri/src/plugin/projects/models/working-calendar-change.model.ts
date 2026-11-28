import { type WorkingCalendarChangeModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { NON_WORKING_DAY_RULE_VALUES, type NonWorkingDayRule } from './non-working-day-rule.model';
import { ProjectCalendarSync } from './project-calendar-sync.model';

/**
 * A change of the working calendar of a project or of the tenant, as `PATCH /:projectId/calendar` and
 * `PATCH /calendar` of the `ProjectsController` take it, and what a calendar sets itself. Each property is unchanged
 * when absent, and taken from above when null.
 */
export class WorkingCalendarChange implements WorkingCalendarChangeModel {
    /**
     * The working weekdays, 0 for Sunday to 6 for Saturday, at least one.
     */
    @Property.array({ items: { type: 'number', format: 'integer', min: 0, max: 6 }, required: false })
    workingWeekdays?: number[] | null;

    /**
     * The holiday calendar of the application whose holidays are no working days.
     */
    @Property.string({ maxLength: 200, required: false })
    holidayCalendarId?: string | null;

    /**
     * What happens to a due date on a day that is not a working day.
     */
    @Property.string({ enum: NON_WORKING_DAY_RULE_VALUES, required: false })
    nonWorkingDay?: NonWorkingDayRule | null;

    /**
     * The calendar the due dates of the tasks are written into, `{ target: null }` for none. Needs the calendar sync
     * of the projects plugin turned on.
     */
    @Property.object({ cls: () => ProjectCalendarSync, required: false })
    calendarSync?: ProjectCalendarSync | null;
}
