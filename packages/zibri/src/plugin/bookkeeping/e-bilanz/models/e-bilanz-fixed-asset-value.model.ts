import { type EBilanzFixedAssetValueModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../../utilities/number.utilities';

/**
 * A value of a column of the statement of changes in fixed assets.
 */
export class EBilanzFixedAssetValue implements Omit<EBilanzFixedAssetValueModel, 'amount'> {
    /**
     * The name of the column, such as `grossCost.beginning`.
     */
    @Property.string()
    column!: string;

    /**
     * The German label of the column.
     */
    @Property.string()
    label!: string;

    /**
     * The amount, or null for NIL.
     */
    @Property.number({ format: 'bignumber', required: false })
    amount!: BigNumber | null;
}