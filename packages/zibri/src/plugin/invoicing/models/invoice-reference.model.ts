import { Property } from '../../../entity/decorators/property.decorator';

/**
 * An invoice another invoice references, such as the one a credit note corrects. EN 16931 states it as the
 * preceding invoice reference (BG-3).
 */
export class InvoiceReference {
    /**
     * The number of the invoice referenced (BT-25).
     */
    @Property.string()
    number!: string;
    /**
     * The date of the invoice referenced (BT-26).
     */
    @Property.date()
    date!: Date;
}