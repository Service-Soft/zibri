import { type EBilanzAccountingStandard } from './e-bilanz-accounting-standard.enum';
import { type EBilanzFieldModel } from './e-bilanz-field.model';
import { type EBilanzFixedAssetModel } from './e-bilanz-fixed-asset.model';
import { type EBilanzPositionModel } from './e-bilanz-position.model';
import { type GermanBookkeepingCompanyModel } from './german-bookkeeping-company.model';

/**
 * An E-Bilanz of a closed fiscal year: the positions of a version of the HGB taxonomy with their amounts and accounts,
 * the statement of changes in fixed assets, and the GCD module with the company.
 */
export type EBilanzContentModel = {
    /**
     * The id of the fiscal year.
     */
    fiscalYearId: string,
    /**
     * The first day of the fiscal year.
     */
    start: string,
    /**
     * The last day of the fiscal year, the balance sheet date.
     */
    end: string,
    /**
     * The version of the HGB taxonomy, such as `6.9`.
     */
    taxonomyVersion: string,
    /**
     * Whether the tax balance sheet is the commercial one (`unified`) or one of its own (`tax`).
     */
    accountingStandard: EBilanzAccountingStandard,
    /**
     * The form of the income statement: `total-cost` or `micro`.
     */
    incomeStatementForm: string,
    /**
     * The company the E-Bilanz states.
     */
    company: GermanBookkeepingCompanyModel,
    /**
     * The positions, in the order of the taxonomy.
     */
    positions: EBilanzPositionModel[],
    /**
     * The statement of changes in fixed assets.
     */
    fixedAssets: EBilanzFixedAssetModel[],
    /**
     * The fields of the GCD module.
     */
    fields: EBilanzFieldModel[]
};