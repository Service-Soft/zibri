import { type EBilanzAccountingStandard } from './e-bilanz-accounting-standard.enum';
import { type EBilanzRevisionStatus } from './e-bilanz-revision-status.enum';

/**
 * The figures of the statement of changes in fixed assets of one position the books do not hold, such as the
 * acquisition costs at the start of the year.
 */
export type EBilanzFixedAssetInputModel = {
    /**
     * The element name of a position of the fixed assets, such as `bs.ass.fixAss.tan.otherEquipm.office`.
     */
    position: string,
    /**
     * The amount of each column named, by the name of the column, such as `grossCost.beginning`, as a decimal.
     */
    values: { column: string, amount: string }[]
};

/**
 * What preparing an E-Bilanz takes beside the books.
 */
export type EBilanzPreparationInputModel = {
    /**
     * Whether the commercial balance sheet is the tax balance sheet (`unified`, Einheitsbilanz) or the tax balance sheet
     * is one of its own (`tax`). Required.
     */
    accountingStandard: EBilanzAccountingStandard,
    /**
     * The version of the taxonomy, or null for the one the fiscal year needs to be stated in.
     */
    taxonomyVersion?: string | null,
    /**
     * The figures of the statement of changes in fixed assets the books do not hold.
     */
    fixedAssets?: EBilanzFixedAssetInputModel[] | null,
    /**
     * How the E-Bilanz corrects the one filed before, required once the fiscal year is filed and refused before.
     * `original` while it is not filed, by default.
     */
    revisionStatus?: EBilanzRevisionStatus | null
};
