import { type ApprovalValueChangeModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * A value an approval request would change on a row, against the value stored when it was proposed.
 */
export class ApprovalValueChange implements ApprovalValueChangeModel {
    /**
     * The name of the property.
     */
    @Property.string()
    key!: string;

    /**
     * The value stored, or null when there is none.
     */
    @Property.unknown({ required: false })
    previousValue?: unknown;

    /**
     * The value the action writes, or null when it removes it.
     */
    @Property.unknown({ required: false })
    newValue?: unknown;
}