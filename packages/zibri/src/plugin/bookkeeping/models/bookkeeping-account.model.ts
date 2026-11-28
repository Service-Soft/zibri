import { type BookkeepingAccountModel } from 'zibri-contract';

import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingAccountType } from './bookkeeping-account-type.enum';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * An account of the books of a tenant, such as `1200 Bank`. Accounts are data the application seeds.
 */
@Entity({ allowOrphan: true, uniques: [['number']] })
export class BookkeepingAccount extends BaseEntity implements BookkeepingAccountModel {
    /**
     * The tenant keeping the books.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

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
     * What the account holds: assets, liabilities and equity on the balance sheet, revenue and expenses in the income
     * statement.
     */
    @Property.string({ enum: BookkeepingAccountType })
    type!: BookkeepingAccountType;

    /**
     * The position of the balance sheet or the income statement the account is reported in, such as `assets.B.IV`, or
     * null for none. A position of a full statement without positions below it. While the balance of the account is
     * a credit, `creditStatementPosition` takes its place when set.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.STATEMENT_POSITION_MAX_LENGTH })
    statementPosition?: string | null;

    /**
     * The position the account is reported in while its balance is a credit, such as `equity-and-liabilities.C.2`
     * for a bank account that is overdrawn, or null to report it in `statementPosition` whatever its balance.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.STATEMENT_POSITION_MAX_LENGTH })
    creditStatementPosition?: string | null;

    /**
     * When the account was closed, or null for an open account. Nothing is posted on a closed account, except the
     * balances closing a fiscal year carries.
     */
    @Property.date({ required: false })
    closedAt?: Date | null;
}

/**
 * What an account is created with.
 */
export type BookkeepingAccountCreateData = Pick<BookkeepingAccount, 'number' | 'name' | 'type' | 'statementPosition' | 'creditStatementPosition'>;
