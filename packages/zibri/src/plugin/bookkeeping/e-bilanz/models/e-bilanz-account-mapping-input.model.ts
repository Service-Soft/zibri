import { type EBilanzAccountMappingChangeModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from '../../models/bookkeeping-limits.model';

/**
 * The position of the taxonomy an account reports as, as `PUT /account-mappings/:accountId` of the
 * `EBilanzController` takes it.
 */
export class EBilanzAccountMappingInput implements EBilanzAccountMappingChangeModel {
    /**
     * The element name of the position, such as `bs.ass.currAss.cashEquiv.bank`.
     */
    @Property.string({ minLength: 1, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    position!: string;

    /**
     * The element name of the position it reports as while its balance is a credit, or null for `position`.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    creditPosition?: string | null;
}