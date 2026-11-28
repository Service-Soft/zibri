import { type PostingRuleBankAccountModel } from './posting-rule-bank-account.model';
import { type PostingRuleRevenueAccountModel } from './posting-rule-revenue-account.model';
import { type PostingRuleTaxAccountModel } from './posting-rule-tax-account.model';

/**
 * The accounts the automatic postings of invoices, credit notes, expenses and bank matches are posted on, as a posting
 * rule set holds them and `PUT /bookkeeping/posting-rule-sets/:id` takes them.
 */
export type PostingRulesModel = {
    /**
     * The id of the account the receivables of invoices are posted on, or null for none.
     */
    receivablesAccountId?: string | null,
    /**
     * The id of the account the payables of expenses are posted on, or null for none.
     */
    payablesAccountId?: string | null,
    /**
     * The revenue account of each VAT category and rate of the items of an invoice.
     */
    revenueAccounts: PostingRuleRevenueAccountModel[],
    /**
     * The account of the output tax of each VAT rate.
     */
    outputTaxAccounts: PostingRuleTaxAccountModel[],
    /**
     * The account of the input tax of each VAT rate.
     */
    inputTaxAccounts: PostingRuleTaxAccountModel[],
    /**
     * The account of the payment differences of each VAT rate, for an invoice paid within the tolerance of the bank
     * matching.
     */
    paymentDifferenceAccounts: PostingRuleTaxAccountModel[],
    /**
     * The account of the books of each bank account.
     */
    bankAccounts: PostingRuleBankAccountModel[],
    /**
     * The id of the equity account of the legal reserve, which the reserve of a year is credited to, such as that of
     * a UG, or null for none.
     */
    legalReserveAccountId?: string | null,
    /**
     * The id of the equity account the legal reserve of a year is taken from, debited, or null for none.
     */
    reserveAllocationAccountId?: string | null
};