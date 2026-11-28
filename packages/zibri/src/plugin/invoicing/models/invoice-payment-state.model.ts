import { BigNumber } from '../../../utilities/number.utilities';
import { InvoicePaymentStatus } from './invoice-payment-status.enum';

/**
 * What of an invoice is paid and what is open, after tax, as the payment service resolves it.
 */
export type InvoicePaymentState = {
    /**
     * The total of the invoice after tax.
     */
    total: BigNumber,
    /**
     * What the credit notes referencing the invoice credit of it, after tax.
     */
    credited: BigNumber,
    /**
     * What the payment sources know as paid of the invoice.
     */
    paid: BigNumber,
    /**
     * What is left to pay: the total less what is credited and what is paid. Below zero when more was paid than is
     * left after the credit notes, which is owed back.
     */
    open: BigNumber,
    /**
     * How far the invoice is paid.
     */
    status: InvoicePaymentStatus
};