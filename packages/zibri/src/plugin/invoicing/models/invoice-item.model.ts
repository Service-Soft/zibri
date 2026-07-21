import { AmountUnit } from './amount-unit.model';
import { Vat } from './vat.model';
import { Property } from '../../../entity/decorators/property.decorator';

/**
 * Contains information about a single item of an invoice.
 */
export class InvoiceItem {
    /**
     * The name of the item.
     */
    @Property.string()
    name!: string;
    /**
     * The amount of the item.
     */
    @Property.number({ min: 1 })
    amount!: number;
    /**
     * The unit, eg. Pieces or meter.
     * Is either a free string or an object containing a display name and a code.
     * (This is required for factur-x/x-rechnung conformance).
     */
    @Property.object({ cls: () => AmountUnit })
    amountUnit!: AmountUnit;
    /**
     * The tax on the item.
     * Is either a percentage number (eg. 20 means 20%) or an object containing a percentage number and a code.
     * (This is required for factur-x/x-rechnung conformance).
     */
    @Property.object({ cls: () => Vat })
    vat!: Vat;
    /**
     * The price of the item.
     */
    @Property.number()
    price!: number;
}