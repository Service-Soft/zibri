import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { NON_WORKING_DAY_RULE_VALUES, type NonWorkingDayRule } from './non-working-day-rule.model';
import { ProjectCalendarSync } from './project-calendar-sync.model';

/**
 * The working calendar of a tenant, which a project takes what it and the projects above it leave unset from. One row
 * per tenant that set one.
 */
@Entity({ allowOrphan: true, uniques: [['tenantId']] })
export class ProjectCalendarDefaults extends BaseEntity {
    /**
     * The tenant.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The working weekdays, 0 for Sunday to 6 for Saturday, or null for Monday to Friday.
     */
    @Property.array({ items: { type: 'number', format: 'integer', min: 0, max: 6 }, required: false })
    workingWeekdays?: number[] | null;

    /**
     * The holiday calendar of the application whose holidays are no working days, or null for none.
     */
    @Property.string({ required: false })
    holidayCalendarId?: string | null;

    /**
     * What happens to a due date on a day that is not a working day, or null for keeping it.
     */
    @Property.string({ enum: NON_WORKING_DAY_RULE_VALUES, required: false })
    nonWorkingDay?: NonWorkingDayRule | null;

    /**
     * The calendar the due dates of the tasks are written into, or null for none.
     */
    @Property.object({ cls: () => ProjectCalendarSync, required: false })
    calendarSync?: ProjectCalendarSync | null;
}
