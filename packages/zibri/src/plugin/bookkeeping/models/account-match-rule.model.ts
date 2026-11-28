import { type AccountMatchRuleModel } from 'zibri-contract';

import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * A rule suggesting the account of the books a bank transaction is matched with, such as the share capital for the
 * deposits of a shareholder. It applies to a transaction that has what it names: the IBAN of the counterparty, the
 * text, or both.
 */
@Entity({ allowOrphan: true })
export class AccountMatchRule extends BaseEntity implements AccountMatchRuleModel {
    /**
     * The tenant keeping the books.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the account suggested.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;

    /**
     * The IBAN of the counterparty, in capitals and without spaces, or null for any.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.IBAN_MAX_LENGTH })
    counterpartyIban?: string | null;

    /**
     * A text the remittance information or the name of the counterparty holds, in any case, or null for any.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.MATCH_TEXT_MAX_LENGTH })
    text?: string | null;
}

/**
 * What a rule is created with.
 */
export type AccountMatchRuleCreateData = Pick<AccountMatchRule, 'accountId' | 'counterpartyIban' | 'text'>;