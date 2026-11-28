import { type AmountUnitModel } from './amount-unit.model';
import { type VatModel } from './vat.model';

/**
 * An item of an invoice.
 */
export type InvoiceItemModel = {
    /**
     * The name of the item.
     */
    name: string,
    /**
     * How many of the unit it is.
     */
    amount: number,
    /**
     * The unit of the amount.
     */
    amountUnit: AmountUnitModel,
    /**
     * The tax of the item.
     */
    vat: VatModel,
    /**
     * The price of one unit, before tax.
     */
    price: number
};