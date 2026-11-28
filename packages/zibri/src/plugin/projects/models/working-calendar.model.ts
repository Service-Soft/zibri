import { type WorkingCalendarModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { NON_WORKING_DAY_RULE_VALUES, type NonWorkingDayRule } from './non-working-day-rule.model';
import { ProjectCalendarSyncTarget } from './project-calendar-sync-target.model';

/**
 * The working days the due dates of recurring tasks are kept to, and the calendar the due dates of tasks are written
 * into, as they apply to a project: what it sets, else what the project above it sets, to the top, else what the
 * tenant sets, else Monday to Friday without holidays, keeping a due date, and no calendar.
 */
export class WorkingCalendar implements WorkingCalendarModel {
    /**
     * The working weekdays, 0 for Sunday to 6 for Saturday.
     */
    @Property.array({ items: { type: 'number', format: 'integer', min: 0, max: 6 } })
    workingWeekdays!: number[];

    /**
     * The holiday calendar of the application whose holidays are no working days, or null for none.
     */
    @Property.string({ required: false })
    holidayCalendarId!: string | null;

    /**
     * What happens to a due date on a day that is not a working day.
     */
    @Property.string({ enum: NON_WORKING_DAY_RULE_VALUES })
    nonWorkingDay!: NonWorkingDayRule;

    /**
     * The calendar the due dates of the tasks are written into, or null for none.
     */
    @Property.object({ cls: () => ProjectCalendarSyncTarget, required: false })
    calendarSync!: ProjectCalendarSyncTarget | null;
}
