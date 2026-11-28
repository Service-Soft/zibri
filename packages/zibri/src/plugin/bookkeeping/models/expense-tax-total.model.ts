import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';

/**
 * What the document of an expense states for one VAT rate.
 */
export class ExpenseTaxTotal {
    /**
     * The VAT rate in percent, such as `19`, or `0` for an amount without VAT.
     */
    @Property.number({ min: 0 })
    rate!: number;

    /**
     * The amount before tax, at least 0.
     */
    @Property.number({ format: 'bignumber' })
    net!: BigNumber;

    /**
     * The VAT, at least 0, which is posted as input tax.
     */
    @Property.number({ format: 'bignumber' })
    tax!: BigNumber;
}
