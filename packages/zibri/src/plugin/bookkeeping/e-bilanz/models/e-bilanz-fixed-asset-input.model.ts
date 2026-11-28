import { type EBilanzFixedAssetInputModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { EBilanzFixedAssetInputValue } from './e-bilanz-fixed-asset-input-value.model';

/**
 * The figures of the statement of changes in fixed assets of one position the books do not hold, such as the
 * acquisition costs at the start of the year.
 */
export class EBilanzFixedAssetInput implements Omit<EBilanzFixedAssetInputModel, 'values'> {
    /**
     * The element name of a position of the fixed assets, such as `bs.ass.fixAss.tan.otherEquipm.office`.
     */
    @Property.string()
    position!: string;

    /**
     * The amount of each column named.
     */
    @Property.array({ items: { type: 'object', cls: () => EBilanzFixedAssetInputValue } })
    values!: EBilanzFixedAssetInputValue[];
}