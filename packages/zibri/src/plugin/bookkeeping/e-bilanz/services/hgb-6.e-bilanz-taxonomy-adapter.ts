/* eslint-disable cspell/spellchecker */
import { Injectable } from '../../../../di/decorators/injectable.decorator';
import { InternalError } from '../../../../error-handling/internal-error.model';
import { BookkeepingDayUtilities } from '../../bookkeeping-day.utilities';
import { EBilanzTaxonomyUtilities } from '../e-bilanz-taxonomy.utilities';
import { EBilanzAccountingStandard } from '../models/e-bilanz-accounting-standard.enum';
import { type EBilanzAppropriationPositions } from '../models/e-bilanz-appropriation-positions.model';
import { type EBilanzBusinessAssetComparisonPositions } from '../models/e-bilanz-business-asset-comparison-positions.model';
import { type EBilanzFieldContext } from '../models/e-bilanz-field-context.model';
import { EBilanzIncomeStatementForm } from '../models/e-bilanz-income-statement-form.enum';
import { type EBilanzTaxonomyPosition } from '../models/e-bilanz-taxonomy-position.model';
import { type EBilanzTaxonomy } from '../models/e-bilanz-taxonomy.model';
import { type EBilanzTotal } from '../models/e-bilanz-total.model';
import { type GermanBookkeepingCompany } from '../models/german-bookkeeping-company.model';
import { type GermanCompanyShareholder } from '../models/german-company-shareholder.model';
import { type EBilanzTaxonomyAdapterInterface } from './e-bilanz-taxonomy-adapter.interface';

const COMPANY: string = 'genInfo.company.id';
const REPORT: string = 'genInfo.report.id';
const PERIOD: string = 'genInfo.report.period';

/**
 * The adapter of the versions 6.x of the HGB taxonomy: maps the positions of the full statements of the HGB of the
 * books (§ 266 and § 275 (2) HGB) to their positions, and states the fields of the GCD module of a corporation. A
 * position of the books that the taxonomy breaks down further maps to the part of it that is not broken down (nicht
 * zuordenbar) where the taxonomy has one: map an account directly to state it in more detail.
 */
@Injectable({ register: 'onUse' })
export class Hgb6EBilanzTaxonomyAdapter implements EBilanzTaxonomyAdapterInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'hgb-6';

    // the positions the tax balance sheet does not have, the self-created intangible assets (§ 5 (2) EStG), the
    // deferred taxes and the difference of the offsetting of plan assets (§ 246 (2) HGB), are left out, so an account
    // on them needs a mapping of its own: the books state them, and a tax balance sheet states something else
    /**
     * The position of the taxonomy each position of the full statements of the HGB reports as, in every version 6.x
     * unless `versionMappings` says otherwise.
     */
    protected readonly statementPositionMapping: Readonly<Record<string, string>> = {
        'assets.A.I.2': 'bs.ass.fixAss.intan.concessionBrands',
        'assets.A.I.3': 'bs.ass.fixAss.intan.goodwill',
        'assets.A.I.4': 'bs.ass.fixAss.intan.advPaym',
        'assets.A.II.1': 'bs.ass.fixAss.tan.landBuildings.misc',
        'assets.A.II.2': 'bs.ass.fixAss.tan.machinery',
        'assets.A.II.3': 'bs.ass.fixAss.tan.otherEquipm.misc',
        'assets.A.II.4': 'bs.ass.fixAss.tan.inConstrAdvPaym',
        'assets.A.III.1': 'bs.ass.fixAss.fin.sharesInAffil.other',
        'assets.A.III.2': 'bs.ass.fixAss.fin.loansToAffil.other',
        'assets.A.III.3': 'bs.ass.fixAss.fin.particip.other',
        'assets.A.III.4': 'bs.ass.fixAss.fin.loansToParticip.other',
        'assets.A.III.5': 'bs.ass.fixAss.fin.securities',
        'assets.A.III.6': 'bs.ass.fixAss.fin.otherLoans.misc',
        'assets.B.I.1': 'bs.ass.currAss.inventory.material',
        'assets.B.I.2': 'bs.ass.currAss.inventory.inProgress',
        'assets.B.I.3': 'bs.ass.currAss.inventory.finishedAndMerch',
        'assets.B.I.4': 'bs.ass.currAss.inventory.advPaymPaid',
        'assets.B.II.1': 'bs.ass.currAss.receiv.trade.misc',
        'assets.B.II.2': 'bs.ass.currAss.receiv.affil',
        'assets.B.II.3': 'bs.ass.currAss.receiv.particip',
        'assets.B.II.4': 'bs.ass.currAss.receiv.other.misc',
        'assets.B.III.1': 'bs.ass.currAss.securities.affil',
        'assets.B.III.2': 'bs.ass.currAss.securities.other',
        'assets.B.IV': 'bs.ass.currAss.cashEquiv.misc',
        'assets.C': 'bs.ass.prepaidExp',
        'equity-and-liabilities.A.I': 'bs.eqLiab.equity.subscribed.corp',
        'equity-and-liabilities.A.II': 'bs.eqLiab.equity.capRes',
        'equity-and-liabilities.A.III.1': 'bs.eqLiab.equity.revenueRes.legal',
        'equity-and-liabilities.A.III.2': 'bs.eqLiab.equity.revenueRes.sharesParentComp',
        'equity-and-liabilities.A.III.3': 'bs.eqLiab.equity.revenueRes.statutory',
        'equity-and-liabilities.A.III.4': 'bs.eqLiab.equity.revenueRes.other',
        'equity-and-liabilities.A.IV': 'bs.eqLiab.equity.retainedEarnings',
        'equity-and-liabilities.A.V': 'bs.eqLiab.equity.netIncome',
        'equity-and-liabilities.B.1': 'bs.eqLiab.accruals.pensions.other',
        'equity-and-liabilities.B.2': 'bs.eqLiab.accruals.tax.misc',
        'equity-and-liabilities.B.3': 'bs.eqLiab.accruals.other',
        'equity-and-liabilities.C.1': 'bs.eqLiab.liab.securities',
        'equity-and-liabilities.C.2': 'bs.eqLiab.liab.bank.misc',
        'equity-and-liabilities.C.3': 'bs.eqLiab.liab.advPaym',
        'equity-and-liabilities.C.4': 'bs.eqLiab.liab.trade.misc',
        'equity-and-liabilities.C.5': 'bs.eqLiab.liab.notes',
        'equity-and-liabilities.C.6': 'bs.eqLiab.liab.assocComp.misc',
        'equity-and-liabilities.C.7': 'bs.eqLiab.liab.particip.misc',
        'equity-and-liabilities.C.8': 'bs.eqLiab.liab.other.other',
        'equity-and-liabilities.D': 'bs.eqLiab.defIncome',
        'income-statement.1': 'is.netIncome.regular.operatingTC.grossTradingProfit.totalOutput.netSales.grossSales.unknownVAT',
        'income-statement.2': 'is.netIncome.regular.operatingTC.grossTradingProfit.totalOutput.inventoryChange',
        'income-statement.3': 'is.netIncome.regular.operatingTC.grossTradingProfit.totalOutput.ownWork',
        'income-statement.4': 'is.netIncome.regular.operatingTC.otherOpRevenue.nonAllocable',
        'income-statement.5.a': 'is.netIncome.regular.operatingTC.grossTradingProfit.materialServices.material.misc',
        'income-statement.5.b': 'is.netIncome.regular.operatingTC.grossTradingProfit.materialServices.services.unknownVAT',
        'income-statement.6.a': 'is.netIncome.regular.operatingTC.staff.salaries.nonAllocable',
        'income-statement.6.b': 'is.netIncome.regular.operatingTC.staff.social.other',
        'income-statement.7.a': 'is.netIncome.regular.operatingTC.deprAmort.fixAss.other',
        'income-statement.7.b': 'is.netIncome.regular.operatingTC.deprAmort.currAss.misc',
        'income-statement.8': 'is.netIncome.regular.operatingTC.otherCost.misc',
        'income-statement.9': 'is.netIncome.regular.fin.netParticipation.earnings.other',
        'income-statement.10': 'is.netIncome.regular.fin.netParticipation.earningSecurities.misc',
        'income-statement.11': 'is.netIncome.regular.fin.netInterest.income.misc',
        'income-statement.12': 'is.netIncome.regular.fin.netParticipation.amortFinanc.other',
        'income-statement.13': 'is.netIncome.regular.fin.netInterest.expenses.misc',
        'income-statement.14': 'is.netIncome.tax.otherIncomeTaxes',
        'income-statement.16': 'is.netIncome.otherTaxes'
    };

    /**
     * What a version maps otherwise, by the version: 6.10 breaks the other taxes down.
     */
    protected readonly versionMappings: Readonly<Record<string, Readonly<Record<string, string>>>> = {
        '6.10': { 'income-statement.16': 'is.netIncome.otherTaxes.other' }
    };

    // the German names of the countries, as the GCD module states the country of the company
    private readonly countryNames: Intl.DisplayNames = new Intl.DisplayNames(['de'], { type: 'region' });

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly balanceSheetResultPosition: string = 'bs.eqLiab.equity.netIncome';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly appropriation: EBilanzAppropriationPositions = {
        statementResultPosition: 'equity-and-liabilities.A.V',
        statementCarriedForwardPosition: 'equity-and-liabilities.A.IV',
        balanceSheetProfit: 'bs.eqLiab.equity.profitLoss',
        netIncome: 'incomeUse.gainLoss.netIncome',
        profitCarriedForward: 'incomeUse.gainLoss.retainedEarningsPrevYear',
        lossCarriedForward: 'incomeUse.gainLoss.accumLossPrevYear',
        legalReserve: 'incomeUse.gainLoss.additionRevenReserves.legalRes',
        otherReserves: 'incomeUse.gainLoss.additionOtherRes',
        otherReservesReleased: 'incomeUse.gainLoss.releaseOtherRes',
        total: 'incomeUse.gainLoss'
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly businessAssetComparison: EBilanzBusinessAssetComparisonPositions = {
        equity: 'bs.eqLiab.equity',
        deficitNotCoveredByCapital: 'bs.ass.deficitNotCoveredByCapital',
        result: 'BVV.profitLoss',
        equityAtEnd: 'BVV.profitLoss.assetsCurrentYear',
        equityAtPreviousEnd: 'BVV.profitLoss.assetsPreviousYear.assets',
        capitalAdjustments: 'BVV.profitLoss.assetsPreviousYear.capAdjustments',
        distributions: 'BVV.profitLoss.withdrawalDistrib',
        contributions: 'BVV.profitLoss.contribution'
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly incomeStatementResultPositions: Readonly<Record<'total-cost' | 'micro', string>> = {
        'total-cost': 'is.netIncome',
        micro: 'ismi.netIncome'
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly balanceSheetTotals: readonly [string, string] = ['bs.ass', 'bs.eqLiab'];

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly totals: readonly EBilanzTotal[] = [
        { statementPosition: 'assets', position: 'bs.ass' },
        { statementPosition: 'equity-and-liabilities', position: 'bs.eqLiab' },
        { statementPosition: 'income-statement.17', position: 'is.netIncome' }
    ];

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly fixedAssetsPosition: string = 'bs.ass.fixAss';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly fixedAssetColumns: EBilanzTaxonomyAdapterInterface['fixedAssetColumns'] = {
        grossBeginning: 'grossCost.beginning',
        additions: 'gross.addition',
        depreciationBeginning: 'accDepr.beginning',
        bookValue: 'all'
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveStatementPositionMapping(taxonomy: EBilanzTaxonomy): Readonly<Record<string, string>> {
        return { ...this.statementPositionMapping, ...this.versionMappings[taxonomy.version] };
    }

    /**
     * Resolves the fields of the GCD module: the period, the company, its address and tax numbers, its shareholders,
     * and the kind of report. The values of a field that is a choice of the taxonomy are the choice, such as `final`
     * for the report status, which a writer states as the element of its choice.
     * @param context - What the fields are resolved from.
     * @returns The values by the name of the field.
     */
    resolveFieldValues(context: EBilanzFieldContext): ReadonlyMap<string, readonly string[]> {
        const res: Map<string, readonly string[]> = new Map();
        const set: (name: string, value: string | null | undefined) => void = (name, value) => {
            if (value != undefined && value !== '') {
                res.set(name, [value]);
            }
        };
        const day: (value: Date) => string = value => BookkeepingDayUtilities.formatDay(value);
        set(`${PERIOD}.fiscalYearBegin`, day(context.fiscalYear.start));
        set(`${PERIOD}.fiscalYearEnd`, day(context.fiscalYear.end));
        set(`${PERIOD}.balSheetClosingDate`, day(context.fiscalYear.end));
        if (context.previousFiscalYear != undefined) {
            set(`${PERIOD}.fiscalPreviousYearBegin`, day(context.previousFiscalYear.start));
            set(`${PERIOD}.fiscalPreviousYearEnd`, day(context.previousFiscalYear.end));
            set(`${PERIOD}.balSheetClosingDatePreviousYear`, day(context.previousFiscalYear.end));
        }
        set(`${REPORT}.reportStatus`, 'final');
        set(`${REPORT}.revisionStatus`, context.revisionStatus);
        set(`${REPORT}.statementType`, 'single');
        set(`${REPORT}.accountingStandard`, context.accountingStandard === EBilanzAccountingStandard.TAX ? 'tax' : 'unified');
        set(`${REPORT}.specialAccountingStandard`, 'core');
        set(`${REPORT}.incomeStatementFormat`, 'GKV');
        set(`${REPORT}.consolidationRange`, 'single');
        set(`${REPORT}.incomeStatementendswithBalProfit`, context.balanceSheetProfit ? 'true' : 'false');
        // the income statement of a micro corporation is a part of its own, which rules out the other one
        const incomeStatement: string = context.incomeStatementForm === EBilanzIncomeStatementForm.MICRO ? 'GuVMicroBilG' : 'GuV';
        const incomeStated: boolean = context.statements.has('incomeStatement') || context.statements.has('microIncomeStatement');
        const elements: string[] = [
            'B',
            ...incomeStated ? [incomeStatement] : [],
            ...context.fixedAssets ? ['BAL'] : [],
            ...context.statements.has('appropriationOfProfits') ? ['EV'] : [],
            'KS',
            // with every income statement, whatever the legal form, as the statement type is never one of those
            // excluded, an opening, liquidation or conversion balance sheet (B.14.3.1.10 of the technical guide)
            ...incomeStated ? ['BVV'] : []
        ];
        res.set(`${REPORT}.reportElement`, elements);
        for (const element of elements) {
            set(`${REPORT}.reportElement.reportElements.${element}`, 'true');
        }
        this.resolveCompanyValues(context.company, set, res);
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateTaxonomy(taxonomy: EBilanzTaxonomy): void {
        const positions: Map<string, EBilanzTaxonomyPosition> = EBilanzTaxonomyUtilities.resolvePositions(taxonomy);
        const named: string[] = [
            ...Object.values(this.resolveStatementPositionMapping(taxonomy)),
            this.balanceSheetResultPosition,
            ...Object.values(this.incomeStatementResultPositions),
            ...this.balanceSheetTotals,
            ...this.totals.map(t => t.position),
            this.fixedAssetsPosition,
            ...Object.entries(this.appropriation).filter(([key]) => !key.startsWith('statement'))
                .map(([, name]) => name),
            ...Object.values(this.businessAssetComparison)
        ];
        const missing: string | undefined = named.find(name => !positions.has(name));
        if (missing != undefined) {
            throw new InternalError(
                `The adapter ${this.name} of the E-Bilanz maps to ${missing}, which the taxonomy ${taxonomy.version} does not have.`
            );
        }
        const columns: string[] = Object.values(this.fixedAssetColumns);
        const missingColumn: string | undefined = columns.find(name => !taxonomy.fixedAssetColumns.some(c => c[0] === name));
        if (missingColumn != undefined) {
            throw new InternalError(
                `The adapter ${this.name} of the E-Bilanz names the column ${missingColumn},`
                + ` which the taxonomy ${taxonomy.version} does not have.`
            );
        }
    }

    /**
     * Resolves the fields of the company and its shareholders.
     * @param company - The company, or undefined while it is not known.
     * @param set - Sets the value of a field.
     * @param res - The values, for a field with a value for each shareholder.
     */
    protected resolveCompanyValues(
        company: GermanBookkeepingCompany | undefined,
        set: (name: string, value: string | null | undefined) => void,
        res: Map<string, readonly string[]>
    ): void {
        if (company == undefined) {
            return;
        }
        set(`${COMPANY}.name`, company.name);
        set(`${COMPANY}.legalStatus`, company.legalStatus);
        set(`${COMPANY}.location.street`, company.address.street);
        set(`${COMPANY}.location.houseNo`, company.address.houseNumber);
        set(`${COMPANY}.location.zipCode`, company.address.postalCode);
        set(`${COMPANY}.location.city`, company.address.city);
        // the country itself, "Firmensitz, Land": its ISO code is an item of its own, location.country.isoCode, which
        // the tax administration does not ask for
        set(`${COMPANY}.location.country`, this.countryNames.of(company.address.country));
        set(`${COMPANY}.idNo.type.companyId.ST13`, company.taxNumber);
        set(`${COMPANY}.idNo.type.companyId.BF4`, company.taxOfficeNumber);
        set(`${COMPANY}.idNo.type.companyId.STWID`, company.economicId);
        set(`${COMPANY}.business`, company.business);
        // a corporation's income is from a trade by its legal form, § 8 (2) KStG
        set(`${COMPANY}.incomeClassification`, 'trade');
        set(`${COMPANY}.entityWithTaxablePurposeBusiness`, 'false');
        set(`${COMPANY}.domesticBranchOfForeignCompany`, 'false');
        const shareholders: GermanBookkeepingCompany['shareholders'] = company.shareholders ?? [];
        const each: (name: string, value: (s: GermanCompanyShareholder) => string | null | undefined) => void
            = (name, value) => {
                const values: (string | null | undefined)[] = shareholders.map(value);
                if (values.some(v => v != undefined)) {
                    res.set(`${COMPANY}.shareholder.${name}`, values.map(v => v ?? ''));
                }
            };
        each('name', s => s.name);
        each('taxnumber', s => s.taxNumber);
        each('taxid', s => s.taxId);
        each('legalStatus', s => s.legalStatus);
        each('ShareDivideKey', s => s.share);
    }
}