import { type EBilanzAccountingStandard } from './e-bilanz-accounting-standard.enum';
import { type EBilanzIncomeStatementForm } from './e-bilanz-income-statement-form.enum';
import { type EBilanzRevisionStatus } from './e-bilanz-revision-status.enum';
import { type EBilanzStatementName } from './e-bilanz-taxonomy-statements.model';
import { type GermanBookkeepingCompany } from './german-bookkeeping-company.model';

/**
 * What the fields of the GCD module of an E-Bilanz are resolved from.
 */
export type EBilanzFieldContext = {
    /**
     * The first and the last day of the fiscal year.
     */
    readonly fiscalYear: { readonly start: Date, readonly end: Date },
    /**
     * The first and the last day of the fiscal year before it, or undefined for the first of the books.
     */
    readonly previousFiscalYear: { readonly start: Date, readonly end: Date } | undefined,
    /**
     * The company, or undefined while it is not known.
     */
    readonly company: GermanBookkeepingCompany | undefined,
    /**
     * Which balance sheet it states.
     */
    readonly accountingStandard: EBilanzAccountingStandard,
    /**
     * The form of its income statement.
     */
    readonly incomeStatementForm: EBilanzIncomeStatementForm,
    /**
     * What it states of itself: `original`, or how it corrects one filed before.
     */
    readonly revisionStatus: EBilanzRevisionStatus,
    /**
     * The statements it states a position of.
     */
    readonly statements: ReadonlySet<EBilanzStatementName>,
    /**
     * Whether it states a statement of changes in fixed assets.
     */
    readonly fixedAssets: boolean,
    /**
     * Whether its balance sheet is drawn up after the partial appropriation of the result, stating the balance sheet
     * profit or loss.
     */
    readonly balanceSheetProfit: boolean
};
