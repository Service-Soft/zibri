import { type EBilanzRequirement } from './e-bilanz-requirement.type';

/**
 * A field of the GCD module of the HGB taxonomy (the company, the report and its period) as data: its element name,
 * what the tax administration asks of it, and its German label.
 */
export type EBilanzTaxonomyFieldRow = readonly [
    name: string,
    requirement: EBilanzRequirement,
    label: string
];