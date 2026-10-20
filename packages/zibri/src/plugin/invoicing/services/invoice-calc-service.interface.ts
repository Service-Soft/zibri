
import { type CurrencyCode } from '../../../localization/models/currency-code.model.ts';
import { BigNumber } from '../../../utilities/number.utilities.ts';
import { InvoiceItem } from '../models/invoice-item.model.ts';
import { Invoice as BaseInvoice } from '../models/invoice.model.ts';
import { Vat } from '../models/vat.model.ts';

/**
 * Handles calculating anything regarding invoices.
 *
 * Amounts are rounded to the minor units of the invoice's currency, the way EN 16931 rounds them:
 * each item's total, and the tax of each tax group once, on the group's rounded total.
 */
export interface InvoiceCalcServiceInterface<Invoice extends BaseInvoice> {
    /**
     * Gets the total price of an item before tax.
     * @param item - The invoice item to get the price from.
     * @param currency - The currency of its invoice.
     * @returns The amount of the item times its price, rounded.
     */
    getItemTotalPriceBeforeTax: (item: InvoiceItem, currency: CurrencyCode) => BigNumber | Promise<BigNumber>,
    /**
     * Gets the total price of an item after tax.
     * @param item - The invoice item to get the price from.
     * @param currency - The currency of its invoice.
     * @returns The total price before tax plus the total tax of the item.
     */
    getItemTotalPriceAfterTax: (item: InvoiceItem, currency: CurrencyCode) => BigNumber | Promise<BigNumber>,
    /**
     * Gets the total tax for the given item, on its own. The tax of an invoice is taxed per tax group
     * rather than summed from its items, see getTotalTaxForTaxGroup.
     * @param item - The item to get the total tax from.
     * @param currency - The currency of its invoice.
     * @returns The total price before tax times tax/100, rounded.
     */
    getItemTotalTax: (item: InvoiceItem, currency: CurrencyCode) => BigNumber | Promise<BigNumber>,
    /**
     * Gets the total price of an invoice before tax.
     * @param invoice - The invoice to get the price from.
     * @returns The addition of the total price before tax of all items in the invoice.
     */
    getTotalBeforeTax: (invoice: Invoice) => BigNumber | Promise<BigNumber>,
    /**
     * Gets the total price of an invoice after tax.
     * @param invoice - The invoice to get the price from.
     * @returns The addition of the total price before tax and the total tax of the invoice.
     */
    getTotalAfterTax: (invoice: Invoice) => BigNumber | Promise<BigNumber>,
    /**
     * Gets the total tax of the invoice.
     * @param invoice - The invoice to get the total tax from.
     * @returns The addition of the total tax of each tax group, by category code and rate.
     */
    getTotalTax: (invoice: Invoice) => BigNumber | Promise<BigNumber>,
    /**
     * Gets the tax groups of an invoice, each once.
     * @param invoice - The invoice to get the tax groups of.
     * @param groupOnlyByRate - Whether or not VAT groups are only determined by rate and not by category code.
     * @returns The VAT of the first item of each group, in the order the groups first occur.
     */
    getTaxGroups: (invoice: Invoice, groupOnlyByRate: boolean) => Vat[] | Promise<Vat[]>,
    /**
     * Gets the total tax for a specific tax group (eg. 19%).
     * @param invoice - The invoice to get the total tax from.
     * @param group - The tax group for which the total tax should be calculated.
     * @param groupOnlyByRate - Whether or not VAT groups are only determined by rate and not by category code.
     * @returns The total price before tax of the group times its tax/100, rounded.
     */
    getTotalTaxForTaxGroup: (invoice: Invoice, group: Vat, groupOnlyByRate: boolean) => BigNumber | Promise<BigNumber>,
    /**
     * Gets the total price of a tax group before tax.
     * @param invoice - The invoice to get the price from.
     * @param group - The tax group to get the total before from.
     * @param groupOnlyByRate - Whether or not VAT groups are only determined by rate and not by category code.
     * @returns The addition of the total price before tax of all items in the group.
     */
    getTotalBeforeTaxForTaxGroup: (invoice: Invoice, group: Vat, groupOnlyByRate: boolean) => BigNumber | Promise<BigNumber>
}