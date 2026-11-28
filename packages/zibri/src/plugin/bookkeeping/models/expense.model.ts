import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { type CurrencyCode, currencyCodeEnum } from '../../../localization/models/currency-code.model';
import { BookkeepingLimits } from './bookkeeping-limits.model';
import { ExpenseSupplier } from './expense-supplier.model';
import { ExpenseTaxTotal } from './expense-tax-total.model';

/**
 * An expense of a tenant: an invoice received or a receipt. It is changed until it is recorded, which posts it, and is
 * read only afterwards: a corrected expense is a new one, which reverses the entry of the one it corrects.
 */
@Entity({ allowOrphan: true, indexes: [['documentDate']] })
export class Expense extends BaseEntity {
    /**
     * The tenant the expense belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

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
     * The amounts of each VAT rate.
     */
    @Property.array({ items: { type: 'object', cls: () => ExpenseTaxTotal } })
    totals!: ExpenseTaxTotal[];

    /**
     * The currency, such as `EUR`.
     */
    @Property.string({ enum: currencyCodeEnum })
    currency!: CurrencyCode;

    /**
     * The id of the account the amounts before tax are posted on.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;

    /**
     * The id of the receipt kept with it, or null for none.
     */
    @Property.string({ format: 'uuid', required: false })
    receiptId?: string | null;

    /**
     * When the expense was recorded, from which it is no longer changed, or null for a draft.
     */
    @Property.date({ required: false })
    recordedAt?: Date | null;

    /**
     * The id of the journal entry recording it posted, or null for none, such as for a tenant that keeps no books.
     */
    @Property.string({ format: 'uuid', required: false })
    postedEntryId?: string | null;

    /**
     * The id of the expense this one corrects, or null for none. Unique, so that an expense is corrected once.
     */
    @Property.string({ format: 'uuid', required: false, unique: true })
    correctsExpenseId?: string | null;
}

/**
 * What an expense is created with.
 */
export type ExpenseCreateData = Omit<Expense, 'id' | 'tenantId'>;
