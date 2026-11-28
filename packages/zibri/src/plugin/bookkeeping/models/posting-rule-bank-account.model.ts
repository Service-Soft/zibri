import { type PostingRuleBankAccountModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The account of the books a bank account of the bank plugin is posted on, as a rule of a posting rule set.
 */
export class PostingRuleBankAccount implements PostingRuleBankAccountModel {
    /**
     * The id of the bank account.
     */
    @Property.string({ format: 'uuid' })
    bankAccountId!: string;

    /**
     * The id of the account of the books, such as `1200 Bank`.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;
}