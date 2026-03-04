
import { BigNumber } from '../../../utilities/big-number.utilities';
import { InvoiceItem } from '../models/invoice-item.model';
import { Invoice as BaseInvoice } from '../models/invoice.model';
import { Vat } from '../models/vat.model';

/**
 * Handles calculating anything regarding invoices.
 */
export interface InvoiceCalcServiceInterface<Invoice extends BaseInvoice> {
    /**
     * Gets the total price of an item before tax.
     * @param item - The invoice item to get the price from.
     * @returns The amount of the item times its price.
     */
    getItemTotalPriceBeforeTax: (item: InvoiceItem) => BigNumber | Promise<BigNumber>,
    /**
     * Gets the total price of an item after tax.
     * @param item - The invoice item to get the price from.
     * @returns The total price before tax times 1 + tax/100.
     */
    getItemTotalPriceAfterTax: (item: InvoiceItem) => BigNumber | Promise<BigNumber>,
    /**
     * Gets the total tax for the given item.
     * @param item - The item to get the total tax from.
     * @returns The total price before tax times tax/100.
     */
    getItemTotalTax: (item: InvoiceItem) => BigNumber | Promise<BigNumber>,
    /**
     * Gets the total price of an invoice before tax.
     * @param invoice - The invoice to get the price from.
     * @returns The addition of the total price before tax of all items in the invoice. If this would be negative this returns 0.
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
     * @returns The addition of the tax of all items of the invoice.
     */
    getTotalTax: (invoice: Invoice) => BigNumber | Promise<BigNumber>,
    /**
     * Gets the total tax for a specific tax group (eg. 19%).
     * @param invoice - The invoice to get the total tax from.
     * @param group - The tax group for which the total tax should be calculated.
     * @param groupOnlyByRate - Whether or not VAT groups are only determined by rate and not by category code.
     * @returns The addition of the tax of all items that are in the provided tax group.
     */
    getTotalTaxForTaxGroup: (invoice: Invoice, group: Vat, groupOnlyByRate: boolean) => BigNumber | Promise<BigNumber>,
    /**
     * Gets the total price of an invoice before tax.
     * @param invoice - The invoice to get the price from.
     * @param group - The tax group to get the total before from.
     * @param groupOnlyByRate - Whether or not VAT groups are only determined by rate and not by category code.
     * @returns The addition of the total price before tax of all items in the invoice. If this would be negative this returns 0.
     */
    getTotalBeforeTaxForTaxGroup: (invoice: Invoice, group: Vat, groupOnlyByRate: boolean) => BigNumber | Promise<BigNumber>
}