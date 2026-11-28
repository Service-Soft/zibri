import { type BankAccountModel } from 'zibri-contract';

import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { BankLimits } from './bank-limits.model';

/**
 * A bank account of a tenant, whose statements the bank plugin imports.
 */
@Entity({ allowOrphan: true })
export class BankAccount extends BaseEntity implements BankAccountModel {
    /**
     * The tenant the account belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The IBAN of the account, in capitals and without spaces, such as `DE89370400440532013000`. Unique among the
     * accounts of its tenant.
     */
    @Property.string({ unique: true, regex: BankLimits.IBAN_REGEX })
    iban!: string;

    /**
     * What the tenant calls the account, such as `Business account`.
     */
    @Property.string({ maxLength: BankLimits.NAME_MAX_LENGTH })
    name!: string;

    /**
     * The currency the account is kept in, such as `EUR`. A statement in another currency is refused.
     */
    @Property.string({ regex: BankLimits.CURRENCY_REGEX })
    currency!: string;
}

/**
 * What a bank account is created with.
 */
export type BankAccountCreateData = Pick<BankAccount, 'iban' | 'name' | 'currency'>;