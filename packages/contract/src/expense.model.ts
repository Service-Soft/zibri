import { type ExpenseDataModel } from './expense-data.model';

/**
 * An expense of a tenant, a received invoice or receipt, as the routes of `/bookkeeping/expenses` answer it. It is
 * changed until it is recorded, and corrected by a new expense afterwards.
 */
export type ExpenseModel = ExpenseDataModel & {
    /**
     * The id of the expense.
     */
    id: string,
    /**
     * The tenant the expense belongs to.
     */
    tenantId: string,
    /**
     * When the expense was recorded, from which it is no longer changed, or null for a draft.
     */
    recordedAt?: Date | null,
    /**
     * The id of the journal entry recording it posted, or null for none.
     */
    postedEntryId?: string | null,
    /**
     * The id of the expense this one corrects, or null for none.
     */
    correctsExpenseId?: string | null
};