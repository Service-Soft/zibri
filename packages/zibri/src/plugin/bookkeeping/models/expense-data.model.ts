import { Property } from '../../../entity/decorators/property.decorator';
import { type CurrencyCode, currencyCodeEnum } from '../../../localization/models/currency-code.model';
import { BookkeepingLimits } from './bookkeeping-limits.model';
import { ExpenseSupplier } from './expense-supplier.model';
import { ExpenseTaxTotal } from './expense-tax-total.model';

/**
 * What an expense states, as `POST /expenses`, `PUT /expenses/:id` and `POST /expenses/:id/correction` of the
 * `BookkeepingController` take it.
 */
export class ExpenseData {
    /**
     * Who issued the document.
     */
    @Property.object({ cls: () => ExpenseSupplier })
    supplier!: ExpenseSupplier;

    /**
     * The number of the document, such as the number of the invoice received.
     */
    @Property.string({ maxLength: BookkeepingLimits.DOCUMENT_REFERENCE_MAX_LENGTH })
    documentNumber!: string;

    /**
     * The day of the document, at midnight UTC, which the expense is posted on.
     */
    @Property.date()
    documentDate!: Date;

    /**
     * The day it is due, at midnight UTC, or null for none.
     */
    @Property.date({ required: false })
    dueDate?: Date | null;

    /**
     * The amounts of each VAT rate, each rate once.
     */
    @Property.array({ items: { type: 'object', cls: () => ExpenseTaxTotal } })
    totals!: ExpenseTaxTotal[];

    /**
     * The currency, such as `EUR`, the one of the books.
     */
    @Property.string({ enum: currencyCodeEnum })
    currency!: CurrencyCode;

    /**
     * The id of the account the amounts before tax are posted on: any account of the books, such as an expense
     * account, or a liability account for a tax paid.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;

    /**
     * The id of the receipt kept with it, or null for none, such as for a bank fee whose document is the statement.
     */
    @Property.string({ format: 'uuid', required: false })
    receiptId?: string | null;
}
