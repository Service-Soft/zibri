import { type PostingRulesModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { PostingRuleBankAccount } from './posting-rule-bank-account.model';
import { PostingRuleRevenueAccount } from './posting-rule-revenue-account.model';
import { PostingRuleTaxAccount } from './posting-rule-tax-account.model';

/**
 * The accounts the automatic postings of invoices, credit notes, expenses and bank matches are posted on, as a posting
 * rule set holds them and `PUT /posting-rule-sets/:id` of the `BookkeepingController` takes them. Every account named
 * needs to be one of the books, and each rate, VAT category and bank account is named once.
 */
export class PostingRules implements PostingRulesModel {
    /**
     * The id of the account the receivables of invoices are posted on, or null for none.
     */
    @Property.string({ format: 'uuid', required: false })
    receivablesAccountId?: string | null;

    /**
     * The id of the account the payables of expenses are posted on, or null for none.
     */
    @Property.string({ format: 'uuid', required: false })
    payablesAccountId?: string | null;

    /**
     * The revenue account of each VAT category and rate of the items of an invoice.
     */
    @Property.array({ items: { type: 'object', cls: () => PostingRuleRevenueAccount } })
    revenueAccounts!: PostingRuleRevenueAccount[];

    /**
     * The account of the output tax of each VAT rate.
     */
    @Property.array({ items: { type: 'object', cls: () => PostingRuleTaxAccount } })
    outputTaxAccounts!: PostingRuleTaxAccount[];

    /**
     * The account of the input tax of each VAT rate.
     */
    @Property.array({ items: { type: 'object', cls: () => PostingRuleTaxAccount } })
    inputTaxAccounts!: PostingRuleTaxAccount[];

    /**
     * The account of the payment differences of each VAT rate, for an invoice paid within the tolerance of the bank
     * matching.
     */
    @Property.array({ items: { type: 'object', cls: () => PostingRuleTaxAccount } })
    paymentDifferenceAccounts!: PostingRuleTaxAccount[];

    /**
     * The account of the books of each bank account.
     */
    @Property.array({ items: { type: 'object', cls: () => PostingRuleBankAccount } })
    bankAccounts!: PostingRuleBankAccount[];

    /**
     * The id of the equity account of the legal reserve, which the reserve of a year is credited to, such as that of
     * a UG, or null for none.
     */
    @Property.string({ format: 'uuid', required: false })
    legalReserveAccountId?: string | null;

    /**
     * The id of the equity account the legal reserve of a year is taken from, debited, or null for none.
     */
    @Property.string({ format: 'uuid', required: false })
    reserveAllocationAccountId?: string | null;
}
