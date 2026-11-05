import { Property } from '../../../entity/decorators/property.decorator';

/**
 * Information about the unit of the amount value.
 * Consists of a display name like "Hours" and a code like "HUR".
 */
export class AmountUnit {
    /**
     * The display name for invoices.
     */
    @Property.string()
    displayName!: string;
    /**
     * The common code for the unit, based on rec20
     * https://unece.org/trade/uncefact/cl-recommendations.
     * Used for x-rechnung.
     */
    @Property.string()
    code!: string;
}