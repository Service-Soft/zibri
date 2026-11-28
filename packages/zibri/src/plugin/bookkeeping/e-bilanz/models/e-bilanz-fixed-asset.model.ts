import { type EBilanzFixedAssetModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { EBilanzFixedAssetValue } from './e-bilanz-fixed-asset-value.model';

/**
 * A position of the fixed assets in the statement of changes in fixed assets (Anlagenspiegel) of an E-Bilanz.
 */
export class EBilanzFixedAsset implements Omit<EBilanzFixedAssetModel, 'values'> {
    /**
     * The element name of the position.
     */
    @Property.string()
    position!: string;

    /**
     * The German label of the position.
     */
    @Property.string()
    label!: string;

    /**
     * The position of the row it is summed into, or null for the row of the fixed assets themselves.
     */
    @Property.string({ required: false })
    parent!: string | null;

    /**
     * The value of each column.
     */
    @Property.array({ items: { type: 'object', cls: () => EBilanzFixedAssetValue } })
    values!: EBilanzFixedAssetValue[];
}
