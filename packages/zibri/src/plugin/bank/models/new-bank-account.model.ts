import { type NewBankAccountModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BankLimits } from './bank-limits.model';

/**
 * A bank account to add, as `POST /accounts` of the `BankController` takes it.
 */
export class NewBankAccount implements NewBankAccountModel {
    /**
     * The IBAN of the account, such as `DE89 3704 0044 0532 0130 00`. Stored in capitals and without spaces.
     */
    // spaces and lower case allowed here, as people write an IBAN, and the entity checks what is left of it
    @Property.string({ regex: /^[\d A-Za-z]+$/, maxLength: 50 })
    iban!: string;

    /**
     * What the tenant calls the account, such as `Business account`.
     */
    @Property.string({ maxLength: BankLimits.NAME_MAX_LENGTH })
    name!: string;

    /**
     * The currency the account is kept in, such as `EUR`.
     */
    @Property.string({ regex: BankLimits.CURRENCY_REGEX })
    currency!: string;
}