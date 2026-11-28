import { type EBilanzRequirement } from './e-bilanz-requirement.type';

/**
 * A position of a statement of the HGB taxonomy as data: its element name, the name of the position it is below or
 * null at the top, its balance side (`D` debit, `C` credit), what the tax administration asks of it, its German label,
 * and the positions it sums, a name with a `-` before it subtracted. Without sums, it sums the positions below it.
 */
export type EBilanzTaxonomyPositionRow = readonly [
    name: string,
    parent: string | null,
    balance: 'D' | 'C',
    requirement: EBilanzRequirement,
    label: string,
    sums?: readonly string[]
];
