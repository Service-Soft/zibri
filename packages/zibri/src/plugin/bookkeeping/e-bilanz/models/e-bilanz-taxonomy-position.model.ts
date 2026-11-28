import { type BookkeepingBalanceSide } from '../../models/bookkeeping-balance-side.type';
import { type EBilanzRequirement } from './e-bilanz-requirement.type';
import { type EBilanzStatementName } from './e-bilanz-taxonomy-statements.model';

/**
 * A position of the taxonomy, resolved from its row.
 */
export type EBilanzTaxonomyPosition = {
    /**
     * The element name, such as `bs.ass.currAss.cashEquiv.bank`.
     */
    readonly name: string,
    /**
     * The statement it is part of.
     */
    readonly statement: EBilanzStatementName,
    /**
     * The name of the position it is below, or null at the top.
     */
    readonly parent: string | null,
    /**
     * The side of a balance it counts positive.
     */
    readonly balance: BookkeepingBalanceSide,
    /**
     * What the tax administration asks of it.
     */
    readonly requirement: EBilanzRequirement,
    /**
     * Its German label.
     */
    readonly label: string,
    /**
     * The positions whose amounts add up to its own, each with `1` or `-1`.
     */
    readonly sums: readonly {
        /**
         * The name of the position added.
         */
        readonly name: string,
        /**
         * `1` for a position added, `-1` for one subtracted.
         */
        readonly weight: 1 | -1
    }[]
};