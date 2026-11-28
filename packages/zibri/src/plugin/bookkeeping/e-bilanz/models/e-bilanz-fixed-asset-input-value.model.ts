import { Property } from '../../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../../utilities/number.utilities';

/**
 * The amount of one column of the statement of changes in fixed assets.
 */
export class EBilanzFixedAssetInputValue {
    /**
     * The name of the column, such as `grossCost.beginning`.
     */
    @Property.string()
    column!: string;

    /**
     * The amount.
     */
    @Property.number({ format: 'bignumber' })
    amount!: BigNumber;
}