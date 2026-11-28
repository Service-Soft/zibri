import { type EBilanzPositionModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../../utilities/number.utilities';
import { EBilanzAccount } from './e-bilanz-account.model';
import { type EBilanzRequirement } from './e-bilanz-requirement.type';
import { type EBilanzStatementName } from './e-bilanz-taxonomy-statements.model';

/**
 * A position of the HGB taxonomy as an E-Bilanz states it: its amount, or NIL, and the accounts it is made of.
 */
export class EBilanzPosition implements Omit<EBilanzPositionModel, 'amount' | 'accounts'> {
    /**
     * The element name of the position, such as `bs.ass.currAss.cashEquiv.bank`.
     */
    @Property.string()
    name!: string;

    /**
     * The statement of the position.
     */
    @Property.string({ enum: { balanceSheet: 'balanceSheet', incomeStatement: 'incomeStatement', microIncomeStatement: 'microIncomeStatement', appropriationOfProfits: 'appropriationOfProfits', businessAssetComparison: 'businessAssetComparison' } })
    statement!: EBilanzStatementName;

    /**
     * The name of the position it is below, or null at the top.
     */
    @Property.string({ required: false })
    parent!: string | null;

    /**
     * The German label of the position.
     */
    @Property.string()
    label!: string;

    /**
     * What the tax administration asks of it.
     */
    @Property.string({ enum: { M: 'M', S: 'S', R: 'R' } })
    requirement!: EBilanzRequirement;

    /**
     * The amount, or null for NIL: a position the tax administration asks for that the books cannot fill.
     */
    @Property.number({ format: 'bignumber', required: false })
    amount!: BigNumber | null;

    /**
     * The accounts the amount is made of.
     */
    @Property.array({ items: { type: 'object', cls: () => EBilanzAccount } })
    accounts!: EBilanzAccount[];
}
