import { type NonWorkingDayRule } from 'zibri-contract';

// from zibri-contract, so that a frontend offers the same choices
// eslint-disable-next-line jsdoc/require-jsdoc
export { NON_WORKING_DAY_RULES, type NonWorkingDayRule } from 'zibri-contract';

/**
 * The rules of `NON_WORKING_DAY_RULES` by themselves, as the `enum` of a property takes them.
 */
export const NON_WORKING_DAY_RULE_VALUES: Record<NonWorkingDayRule, NonWorkingDayRule> = {
    keep: 'keep',
    previous: 'previous',
    next: 'next'
};