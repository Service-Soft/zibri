import { type PaginationResult } from '../../../data-source/models/pagination-result.model';
import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type ExpenseData } from '../models/expense-data.model';
import { type ExpenseFilter } from '../models/expense-filter.model';
import { type ExpenseReceiptFile } from '../models/expense-receipt-file.model';
import { type ExpenseReceipt } from '../models/expense-receipt.model';
import { type Expense } from '../models/expense.model';

/**
 * Keeps the expenses of the current tenant: drafts, which change until they are recorded, recording, which posts them,
 * correcting a recorded one by a new one, and their receipts.
 */
export interface ExpenseServiceInterface {
    /**
     * Finds a page of the expenses the filter matches, the latest document first, and how many match.
     * @param page - The page, counting from 1.
     * @param limit - How many expenses a page holds.
     * @param filter - The text a `search` finds them by, in their document number or the name of their supplier.
     * @returns The page.
     */
    findExpenses: (page: number, limit: number, filter: ExpenseFilter) => Promise<PaginationResult<Expense>>,
    /**
     * Creates an expense as a draft.
     * @throws A BadRequestError for totals of no rate, a rate twice, an amount below 0, a total of 0, or a day with a
     * time.
     * @throws A ConflictError for an account that is not one of the books, and a NotFoundError for a receipt the
     * tenant does not have.
     */
    createExpense: (data: ExpenseData, transaction?: Transaction) => Promise<Expense>,
    /**
     * Changes a draft.
     * @throws A ConflictError for a recorded expense, and what creating one refuses.
     */
    updateExpense: (id: string, data: ExpenseData, transaction?: Transaction) => Promise<Expense>,
    /**
     * Records a draft, which posts it in the same transaction: its amounts before tax on its account and its tax as
     * input tax, against the payables. A tenant without bookkeeping settings records it without posting.
     * @throws A ConflictError for an expense recorded already, and what posting it refuses it with.
     */
    recordExpense: (id: string, transaction?: Transaction) => Promise<Expense>,
    /**
     * Corrects a recorded expense: creates and records a new one referencing it, and reverses the entry of the one it
     * corrects, on the day of the new document.
     * @throws A ConflictError for a draft, and for an expense corrected already.
     */
    correctExpense: (id: string, data: ExpenseData, transaction?: Transaction) => Promise<Expense>,
    /**
     * Keeps the document of an expense in the file store of the receipts, archived for `receiptRetention`.
     */
    createReceipt: (file: ExpenseReceiptFile, transaction?: Transaction) => Promise<ExpenseReceipt>
}