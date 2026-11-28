import { type EBilanzTaxonomyColumnRow } from './e-bilanz-taxonomy-column-row.type';
import { type EBilanzTaxonomyFieldRow } from './e-bilanz-taxonomy-field-row.type';
import { type EBilanzTaxonomyStatements } from './e-bilanz-taxonomy-statements.model';

/**
 * A version of the HGB taxonomy the E-Bilanz is stated in, as data: what a corporation reports in it, the fiscal years
 * it applies to, and the adapter that maps the books to it. Rebuilt from the official zip of XBRL Deutschland e.V. By
 * `scripts/build-e-bilanz-taxonomy.mjs` of the package.
 */
export type EBilanzTaxonomy = {
    /**
     * The version, such as `6.9`.
     */
    readonly version: string,
    /**
     * The date of the taxonomy, part of the names of its schemas, such as `2025-04-01`.
     */
    readonly date: string,
    /**
     * The `name` of the adapter that maps the books to the taxonomy, such as `hgb-6` for the versions 6.x.
     */
    readonly adapter: string,
    /**
     * The first day of the first fiscal year the version may be used for, at midnight UTC: it applies to the fiscal
     * years starting on that day or after.
     */
    readonly allowedFrom: Date,
    /**
     * The first day of the first fiscal year the version needs to be used for, at midnight UTC, until a later version
     * needs to be.
     */
    readonly mandatoryFrom: Date,
    /**
     * The copyright notice of XBRL Deutschland e.V., which every copy of the data keeps.
     */
    readonly notice: string,
    /**
     * The positions of each statement.
     */
    readonly statements: EBilanzTaxonomyStatements,
    /**
     * The columns of the statement of changes in fixed assets (Anlagenspiegel, gross).
     */
    readonly fixedAssetColumns: readonly EBilanzTaxonomyColumnRow[],
    /**
     * The fields of the GCD module a corporation fills.
     */
    readonly gcdFields: readonly EBilanzTaxonomyFieldRow[]
};