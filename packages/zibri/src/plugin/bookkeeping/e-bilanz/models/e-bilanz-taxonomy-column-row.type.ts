import { type EBilanzRequirement } from './e-bilanz-requirement.type';

/**
 * A column of the statement of changes in fixed assets (Anlagenspiegel) of the HGB taxonomy as data: the name of the
 * member of its dimension, the column it is part of or null, what the tax administration asks of it, its German
 * label, and the columns it sums, a name with a `-` before it subtracted. Without sums, it sums the columns below it.
 */
export type EBilanzTaxonomyColumnRow = readonly [
    name: string,
    parent: string | null,
    requirement: EBilanzRequirement | null,
    label: string,
    sums?: readonly string[]
];