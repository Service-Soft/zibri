import { type ApprovalPreconditionModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * A row an approval request was proposed against, as it was stored then. Approving refuses the request once the row
 * holds something else.
 */
export class ApprovalPrecondition implements ApprovalPreconditionModel {
    /**
     * The table of the row, such as `task`.
     */
    @Property.string()
    entity!: string;

    /**
     * The id of the row.
     */
    @Property.string()
    id!: string;

    /**
     * A hash of what the row held.
     */
    @Property.string()
    hash!: string;
}