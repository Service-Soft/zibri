import { type BookkeepingCompany } from '../../models/bookkeeping-company.model';
import { type BookkeepingStatement } from '../../models/bookkeeping-statement.model';
import { type EBilanzTaxonomyAdapterInterface } from '../services/e-bilanz-taxonomy-adapter.interface';
import { type EBilanzAccountBalance } from './e-bilanz-account-balance.model';
import { type EBilanzAccountMapping } from './e-bilanz-account-mapping.model';
import { type EBilanzAccountingStandard } from './e-bilanz-accounting-standard.enum';
import { type EBilanzEquityLine } from './e-bilanz-equity-line.model';
import { type EBilanzFixedAssetInput } from './e-bilanz-fixed-asset-input.model';
import { type EBilanzIncomeStatementForm } from './e-bilanz-income-statement-form.enum';
import { type EBilanzResultLine } from './e-bilanz-result-line.model';
import { type EBilanzRevisionStatus } from './e-bilanz-revision-status.enum';
import { type EBilanzTaxonomy } from './e-bilanz-taxonomy.model';

/**
 * What the E-Bilanz of a fiscal year is resolved from: the books, the company, the version of the taxonomy and its
 * adapter, and what the preparation takes beside.
 */
export type EBilanzBooks = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly taxonomy: EBilanzTaxonomy,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly adapter: EBilanzTaxonomyAdapterInterface,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly fiscalYear: { readonly id: string, readonly start: Date, readonly end: Date },
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly previousFiscalYear: { readonly start: Date, readonly end: Date } | undefined,
    /**
     * The company of the bookkeeping settings, or undefined for none. It states what the GCD module asks of it once it
     * is a `GermanBookkeepingCompany`.
     */
    readonly company: BookkeepingCompany | undefined,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly accountingStandard: EBilanzAccountingStandard,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly incomeStatementForm: EBilanzIncomeStatementForm,
    /**
     * What the E-Bilanz states of itself: `original` for the first one of the fiscal year, or how it corrects one
     * filed before.
     */
    readonly revisionStatus: EBilanzRevisionStatus,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly balances: readonly EBilanzAccountBalance[],
    /**
     * The lines on the accounts of the equity of every entry of the fiscal year but those carrying its balances in, the
     * opening entry and those against a carry-forward account, and its closing entry, which the steuerlicher
     * Betriebsvermögensvergleich reads the contributions and distributions of the year from.
     */
    readonly equityLines: readonly EBilanzEquityLine[],
    /**
     * The id of the account the allocation to the legal reserve is posted on, the `reserveAllocationAccountId` of the
     * posting rules valid at the end of the year, or undefined for none.
     */
    readonly legalReserveAllocationAccountId: string | undefined,
    /**
     * The lines of the closing entry carrying the result of the year into equity, those with the role `RESULT`, none for
     * a closing booking no result.
     */
    readonly resultLines: readonly EBilanzResultLine[],
    /**
     * The accounts mapped to a position of the taxonomy of their own.
     */
    readonly accountMappings: readonly EBilanzAccountMapping[],
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly fixedAssets: readonly EBilanzFixedAssetInput[],
    /**
     * The full statements of the books archived at the closing, which the amounts are checked against.
     */
    readonly statements: readonly BookkeepingStatement[]
};