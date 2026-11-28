import { type PostingRuleRevenueAccountModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * The account the revenue of a VAT category and rate of an invoice is posted on, as a rule of a posting rule set.
 */
export class PostingRuleRevenueAccount implements PostingRuleRevenueAccountModel {
    /**
     * The VAT category code of the items, such as `S` for the standard rate or `E` for exempt, as an invoice states it.
     */
    @Property.string({ maxLength: BookkeepingLimits.VAT_CATEGORY_CODE_MAX_LENGTH })
    categoryCode!: string;

    /**
     * The VAT rate in percent, such as `19`.
     */
    @Property.number({ min: 0 })
    rate!: number;

    /**
     * The id of the revenue account.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;
}