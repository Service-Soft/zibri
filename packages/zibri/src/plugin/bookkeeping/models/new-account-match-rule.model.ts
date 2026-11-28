import { type NewAccountMatchRuleModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * A rule suggesting the account of the books a bank transaction is matched with, as `POST /account-match-rules` of
 * the `BookkeepingController` takes it. It needs to name an IBAN, a text, or both.
 */
export class NewAccountMatchRule implements NewAccountMatchRuleModel {
    /**
     * The id of the account suggested, an account of the books.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;

    /**
     * The IBAN of the counterparty, such as `DE89 3704 0044 0532 0130 00`, or null for any.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.IBAN_MAX_LENGTH })
    counterpartyIban?: string | null;

    /**
     * A text the remittance information or the name of the counterparty holds, in any case, or null for any.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.MATCH_TEXT_MAX_LENGTH })
    text?: string | null;
}
