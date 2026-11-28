import { type PostingRuleTaxAccountModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The account an amount of a VAT rate is posted on, as a rule of a posting rule set: the output tax, the input tax, or
 * the payment differences of that rate.
 */
export class PostingRuleTaxAccount implements PostingRuleTaxAccountModel {
    /**
     * The VAT rate in percent, such as `19`.
     */
    @Property.number({ min: 0 })
    rate!: number;

    /**
     * The id of the account.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;
}
