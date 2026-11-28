import { Property } from '../../../entity/decorators/property.decorator';
import { RECURRENCE_UNIT_VALUES, type RecurrenceUnit } from './recurrence-unit.model';

/**
 * When a recurring task is due, counted from its `startsOn`: every `every` days, weeks, months or years, on the days
 * the unit takes, until a day or a number of occurrences. A day is held as its midnight UTC, such as `2026-07-31`.
 */
export class TaskRecurrence {
    /**
     * How many units lie between two periods, such as 3 for every quarter with `month`.
     */
    @Property.number({ format: 'integer', min: 1, max: 1000 })
    every!: number;

    /**
     * The unit of a period.
     */
    @Property.string({ enum: RECURRENCE_UNIT_VALUES })
    unit!: RecurrenceUnit;

    /**
     * With `week`: the weekdays of each week it is due on, 0 for Sunday to 6 for Saturday. The weekday of `startsOn`
     * when absent.
     */
    @Property.array({ items: { type: 'number', format: 'integer', min: 0, max: 6 }, required: false })
    weekdays?: number[] | null;

    /**
     * With `month` and `year`: the day of the month it is due on, 1 to 31, or -1 for the last day. A month without the
     * day takes its last day. The day of `startsOn` when absent.
     */
    @Property.number({ format: 'integer', min: -1, max: 31, required: false })
    dayOfMonth?: number | null;

    /**
     * With `year`: the month it is due in, 1 for January to 12. The month of `startsOn` when absent.
     */
    @Property.number({ format: 'integer', min: 1, max: 12, required: false })
    month?: number | null;

    /**
     * The last day an occurrence may fall on, or null for none.
     */
    @Property.date({ required: false })
    until?: Date | null;

    /**
     * The most occurrences, counted from `startsOn`, or null for no limit.
     */
    @Property.number({ format: 'integer', min: 1, required: false })
    count?: number | null;
}