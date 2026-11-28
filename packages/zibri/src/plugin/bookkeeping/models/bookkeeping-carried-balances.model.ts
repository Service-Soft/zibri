import { type BookkeepingAccountBalance } from './bookkeeping-account-balance.model';

/**
 * The balances a fiscal year starts with: those of its opening entry, which the closing of the year before posts, and
 * those carried over by hand against a carry-forward account, such as the balances of books kept elsewhere before.
 */
export type BookkeepingCarriedBalances = {
    /**
     * What the lines carrying the balances in add up to on each account, the carry-forward accounts left out.
     */
    balances: BookkeepingAccountBalance[],
    /**
     * The ids of the entries carrying the balances in: the opening entry, and each entry with a line on a carry-forward
     * account.
     */
    entryIds: string[]
};
