import { type RecurrenceUnit } from 'zibri-contract';

// from zibri-contract, so that a frontend offers the same units
// eslint-disable-next-line jsdoc/require-jsdoc
export { RECURRENCE_UNITS, type RecurrenceUnit } from 'zibri-contract';

/**
 * The units of `RECURRENCE_UNITS` by themselves, as the `enum` of a property takes them.
 */
export const RECURRENCE_UNIT_VALUES: Record<RecurrenceUnit, RecurrenceUnit> = { day: 'day', week: 'week', month: 'month', year: 'year' };
