import { Transaction } from '../../../data-source/transaction/transaction.model.ts';
import { InvoiceAddress } from '../models/invoice-address.model.ts';

/**
 * Handles generating unique and consecutive numbers for invoices.
 */
export interface InvoiceNumberServiceInterface<AddressData extends InvoiceAddress> {
    /**
     * Generates a new invoice number.
     * @param recipientId - The id of the recipient of the invoice.
     * @param invoiceAddress - The address data of the recipient of the invoice.
     * @param transaction - An optional transaction from outside to make sure any changes only apply when the transaction is committed.
     * @param nameAbbreviation - An optional name abbreviation if you don't want to generate one.
     * @returns A promise of the new invoice number.
     * @throws A ConflictError when the abbreviation belongs to another recipient.
     */
    generateInvoiceNumber: (
        recipientId: string,
        invoiceAddress: AddressData,
        transaction?: Transaction,
        nameAbbreviation?: string
    ) => string | Promise<string>,
    /**
     * Generates a temporary invoice number with the prefix "TEMP".
     * This does not increase the number of invoices which can be helpful if you create an invoice that might not be sent out.
     * @param recipientId - The id of the recipient of the invoice.
     * @param invoiceAddress - The address data of the customer.
     * @param nameAbbreviation - An optional name abbreviation if you don't want to generate one.
     * @returns A promise of the new temporary invoice number.
     */
    generateTemporaryInvoiceNumber: (
        recipientId: string,
        invoiceAddress: InvoiceAddress,
        nameAbbreviation?: string
    ) => string | Promise<string>,
    /**
     * Suggests a name abbreviation for a recipient: the first letters and digits of a company name,
     * or the first letters of first and last name. Two recipients can get the same suggestion.
     * @param invoiceAddress - The address data of the recipient.
     * @returns The abbreviation.
     */
    getSuggestedNameAbbreviation: (invoiceAddress: AddressData) => string
}