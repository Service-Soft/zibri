import { type NewBookkeepingAccountModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingAccountType } from './bookkeeping-account-type.enum';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * An account to add to the books of a tenant, as `POST /accounts` of the `BookkeepingController` takes it.
 */
export class NewBookkeepingAccount implements NewBookkeepingAccountModel {
    /**
     * The number of the account, such as `1200`. Unique among the accounts of its tenant.
     */
    @Property.string({ maxLength: BookkeepingLimits.ACCOUNT_NUMBER_MAX_LENGTH })
    number!: string;

    /**
     * The name of the account, such as `Bank`.
     */
    @Property.string({ maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    name!: string;

    /**
     * What the account holds.
     */
    @Property.string({ enum: BookkeepingAccountType })
    type!: BookkeepingAccountType;

    /**
     * The position of the balance sheet or the income statement the account is reported in, such as `assets.B.IV`, or
     * null for none.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.STATEMENT_POSITION_MAX_LENGTH })
    statementPosition?: string | null;

    /**
     * The position the account is reported in while its balance is a credit, such as `equity-and-liabilities.C.2`
     * for a bank account that is overdrawn, or null for none.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.STATEMENT_POSITION_MAX_LENGTH })
    creditStatementPosition?: string | null;
}