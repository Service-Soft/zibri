import { type ExpenseSupplierModel } from './expense-supplier.model';
import { type ExpenseTaxTotalModel } from './expense-tax-total.model';

/**
 * What an expense states, as `POST /bookkeeping/expenses` and `PUT /bookkeeping/expenses/:id` take it. Days are
 * written as `2026-11-30`.
 */
export type ExpenseDataModel = {
    /**
     * Who issued the document.
     */
    supplier: ExpenseSupplierModel,
    /**
     * The number of the document, such as the number of the invoice received.
     */
    documentNumber: string,
    /**
     * The day of the document, which the expense is posted on.
     */
    documentDate: Date,
    /**
     * The day it is due, or null for none.
     */
    dueDate?: Date | null,
    /**
     * The amounts of each VAT rate.
     */
    totals: ExpenseTaxTotalModel[],
    /**
     * The currency, such as `EUR`, the one of the books.
     */
    currency: string,
    /**
     * The id of the account the amounts before tax are posted on: any account, such as an expense account, or a
     * liability account for a tax paid.
     */
    accountId: string,
    /**
     * The id of the receipt kept with it, or null for none, such as for a bank fee whose document is the statement.
     */
    receiptId?: string | null
};
