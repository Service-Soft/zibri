import { type InvoiceCalcServiceInterface } from './invoice-calc-service.interface.ts';
import { InternalError } from '../../../error-handling/internal-error.model.ts';
import { type LocalizeServiceInterface } from '../../../localization/localize-service.interface.ts';
import { BigNumber } from '../../../utilities/number.utilities.ts';
import { Invoice } from '../models/invoice.model.ts';

/**
 * Validates that the given invoice totals at least 0 before tax. One that totals less is a credit
 * note, which an invoice's pdf and electronic invoice cannot state.
 * @param invoice - The invoice.
 * @param invoiceCalcService - The service calculating its total.
 * @param localizeService - The service knowing the minor units of its currency, for the message.
 * @throws When the invoice totals less than 0.
 */
export async function validateInvoiceTotal(
    invoice: Invoice,
    invoiceCalcService: InvoiceCalcServiceInterface<Invoice>,
    localizeService: LocalizeServiceInterface
): Promise<void> {
    const total: BigNumber = await invoiceCalcService.getTotalBeforeTax(invoice);
    if (total.isLessThan(0)) {
        const amount: string = total.toFixed(localizeService.getCurrencyMinorUnits(invoice.currency));
        throw new InternalError(
            `The invoice totals ${amount} ${invoice.currency} before tax. An invoice cannot total less than 0, issue a credit note instead.`
        );
    }
}