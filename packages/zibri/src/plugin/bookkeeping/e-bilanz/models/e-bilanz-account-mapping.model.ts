import { type EBilanzAccountMappingModel } from 'zibri-contract';

import { BaseEntity } from '../../../../entity/base-entity.model';
import { Entity } from '../../../../entity/decorators/entity.decorator';
import { Property } from '../../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from '../../models/bookkeeping-limits.model';

/**
 * An account of the books mapped to a position of the HGB taxonomy of its own, in place of the position its statement
 * position maps to, such as the revenue at 19 % to the revenue of the general rate of VAT. At most one per account.
 */
@Entity({ allowOrphan: true, uniques: [['accountId']] })
export class EBilanzAccountMapping extends BaseEntity implements EBilanzAccountMappingModel {
    /**
     * The tenant keeping the books.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the account.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;

    /**
     * The element name of the position the account reports as, such as
     * `is.netIncome.regular.operatingTC.grossTradingProfit.totalOutput.netSales.grossSales.generalRateVAT`.
     */
    @Property.string({ maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    position!: string;

    /**
     * The element name of the position it reports as while its balance is a credit, or null for `position`.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    creditPosition?: string | null;
}

/**
 * What an account mapping is created with.
 */
export type EBilanzAccountMappingCreateData = Pick<EBilanzAccountMapping, 'accountId' | 'position' | 'creditPosition'>;
