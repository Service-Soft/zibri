/**
 * What happens to a due date that falls on a day that is not a working day: it is kept, moved to the previous working
 * day, or moved to the next one.
 */
// eslint-disable-next-line typescript/typedef
export const NON_WORKING_DAY_RULES = ['keep', 'previous', 'next'] as const;

/**
 * One of {@link NON_WORKING_DAY_RULES}.
 */
export type NonWorkingDayRule = typeof NON_WORKING_DAY_RULES[number];