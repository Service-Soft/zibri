import { type BookkeepingAccountModel } from './bookkeeping-account.model';

/**
 * A row of a trial balance: what the lines of a fiscal year add up to on one account. Amounts are decimal strings.
 */
export type BookkeepingTrialBalanceRowModel = {
    /**
     * The account.
     */
    account: BookkeepingAccountModel,
    /**
     * The sum of its debits.
     */
    debit: string,
    /**
     * The sum of its credits.
     */
    credit: string,
    /**
     * Its debits less its credits.
     */
    balance: string
};