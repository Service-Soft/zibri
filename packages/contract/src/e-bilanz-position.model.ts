import { type EBilanzAccountModel } from './e-bilanz-account.model';

/**
 * A position of the HGB taxonomy as an E-Bilanz states it.
 */
export type EBilanzPositionModel = {
    /**
     * The element name of the position, such as `bs.ass.currAss.cashEquiv.bank`.
     */
    name: string,
    /**
     * The statement of the position: `balanceSheet`, `incomeStatement`, `microIncomeStatement`,
     * `appropriationOfProfits` or `businessAssetComparison`, the steuerlicher Betriebsvermögensvergleich (BVV).
     */
    statement: string,
    /**
     * The name of the position it is below, or null at the top.
     */
    parent: string | null,
    /**
     * The German label of the position.
     */
    label: string,
    /**
     * What the tax administration asks of it: `M`, `S` or `R`.
     */
    requirement: string,
    /**
     * The amount as a decimal, or null for NIL: a position the tax administration asks for that the books cannot
     * fill.
     */
    amount: string | null,
    /**
     * The accounts the amount is made of.
     */
    accounts: EBilanzAccountModel[]
};