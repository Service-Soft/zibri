import { type EBilanzFindingModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';

/**
 * Something an E-Bilanz needs before it can be prepared, naming the position, field or account it is about.
 */
export class EBilanzFinding implements EBilanzFindingModel {
    /**
     * The element name of the position or field, or the number of the account, it is about, or null for the whole.
     */
    @Property.string({ required: false })
    position!: string | null;

    /**
     * What needs to change.
     */
    @Property.string()
    message!: string;
}
