/* eslint-disable cspell/spellchecker */
import { Repository } from '../../../../../data-source/repository/repository';
import { type Transaction } from '../../../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../../../di/decorators/injectable.decorator';
import { inject } from '../../../../../di/inject.function';
import { type PdfContentDefinition, type PdfDocumentDefinition } from '../../../../../document/pdf.utilities';
import { BadRequestError } from '../../../../../error-handling/errors/bad-request.error';
import { ConflictError } from '../../../../../error-handling/errors/conflict.error';
import { InternalError } from '../../../../../error-handling/internal-error.model';
import { $ts } from '../../../../../localization/translate.function';
import { BigNumber } from '../../../../../utilities/number.utilities';
import { BookkeepingDayUtilities } from '../../../bookkeeping-day.utilities';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../../../bookkeeping.tokens';
import { type BookkeepingClosing } from '../../../models/bookkeeping-closing.model';
import { type BookkeepingCompany } from '../../../models/bookkeeping-company.model';
import { type BookkeepingReportContext } from '../../../models/bookkeeping-report-context.model';
import { type BookkeepingSettingsCreateData } from '../../../models/bookkeeping-settings.model';
import { type BookkeepingStatementForms } from '../../../models/bookkeeping-statement-forms.model';
import { type BookkeepingStatementPosition } from '../../../models/bookkeeping-statement-position.model';
import { type BookkeepingStatement } from '../../../models/bookkeeping-statement.model';
import { FiscalYear } from '../../../models/fiscal-year.model';
import { type NewJournalEntry } from '../../../models/new-journal-entry.model';
import { HGB_BALANCE_SHEET } from '../../../statements/hgb-balance-sheet.model';
import { HGB_INCOME_STATEMENT } from '../../../statements/hgb-income-statement.model';
import { HGB_MICRO_BALANCE_SHEET } from '../../../statements/hgb-micro-balance-sheet.model';
import { HGB_MICRO_INCOME_STATEMENT } from '../../../statements/hgb-micro-income-statement.model';
import { HGB_SMALL_BALANCE_SHEET } from '../../../statements/hgb-small-balance-sheet.model';
import { type BookkeepingReportServiceInterface } from '../../bookkeeping-report-service.interface';
import { type BookkeepingConformance, type BookkeepingConformanceServiceInterface } from '../bookkeeping-conformance-service.interface';
import { HgbSizeClass } from './hgb-size-class.enum';
import { HGB_SIZE_CLASS_THRESHOLDS, type HgbSizeClassThresholds } from './hgb-size-class-thresholds.model';
import { type HgbSizeThreshold } from './hgb-size-threshold.model';

/**
 * What a corporation is classified by on a balance sheet date.
 */
type SizeFigures = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    balanceSheetTotal: BigNumber,
    // eslint-disable-next-line jsdoc/require-jsdoc
    revenue: BigNumber,
    // eslint-disable-next-line jsdoc/require-jsdoc
    employees: number
};

/**
 * A limit between two size classes, by the class below it.
 */
type SizeLimit = 'micro' | 'small' | 'medium';

const LIMITS: SizeLimit[] = ['micro', 'small', 'medium'];

/**
 * Holds the statements of a German corporation (Kapitalgesellschaft: GmbH, UG, AG, KGaA, SE) to the HGB: resolves
 * its size class by § 267 and § 267a HGB, and from it the forms of its statements, and adds the note below the
 * balance sheet of a micro corporation, whose text the application passes.
 */
@Injectable({ register: 'onUse' })
export class HgbCorporationConformanceService implements BookkeepingConformanceServiceInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: BookkeepingConformance = 'hgb-corporation';

    /**
     * The legal forms of the corporations it applies to.
     */
    protected readonly legalForms: string[] = ['GmbH', 'UG', 'AG', 'KGaA', 'SE'];

    /**
     * The thresholds it classifies by, the latest last.
     */
    protected readonly thresholds: HgbSizeClassThresholds[] = HGB_SIZE_CLASS_THRESHOLDS;

    // read when used: the report service resolves the forms of a statement with this service
    private get reportService(): BookkeepingReportServiceInterface {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_SERVICE);
    }

    private get fiscalYearRepository(): Repository<FiscalYear> {
        return inject(repositoryTokenFor(FiscalYear));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    isApplicable(legalForm: string): boolean {
        return this.legalForms.includes(legalForm);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveClosingProposals(): NewJournalEntry[] {
        return [];
    }

    /**
     * Validates that the fiscal year has its average number of employees, without which the size class of its
     * statements is not known.
     * @param closing - The fiscal year about to be closed.
     * @throws A ConflictError when it has none.
     */
    validateClosing(closing: BookkeepingClosing): void {
        this.validateEmployees(closing.fiscalYear);
    }

    /**
     * Resolves the forms of the statements by the size class: the shortened forms of a micro corporation, the
     * shortened balance sheet and the full income statement of a small one, and the full forms of every other.
     * @param context - The fiscal year.
     * @returns The ids of the structures.
     * @throws A ConflictError for books not kept in EUR, which the thresholds are in, § 244 HGB.
     */
    async resolveStatementForms(context: BookkeepingReportContext): Promise<BookkeepingStatementForms> {
        if (context.settings.currency !== 'EUR') {
            throw new ConflictError($ts`The books of a corporation under the HGB need to be kept in EUR, and are kept in ${context.settings.currency}.`);
        }
        switch (await this.resolveSizeClass(context.fiscalYear, context.transaction)) {
            case HgbSizeClass.MICRO: {
                return { balanceSheet: HGB_MICRO_BALANCE_SHEET.id, incomeStatement: HGB_MICRO_INCOME_STATEMENT.id };
            }
            case HgbSizeClass.SMALL: {
                return { balanceSheet: HGB_SMALL_BALANCE_SHEET.id, incomeStatement: HGB_INCOME_STATEMENT.id };
            }
            case HgbSizeClass.MEDIUM:
            case HgbSizeClass.LARGE: {
                return { balanceSheet: HGB_BALANCE_SHEET.id, incomeStatement: HGB_INCOME_STATEMENT.id };
            }
        }
    }

    /**
     * Adds the `balanceSheetNote` of the fiscal year below the balance sheet of a micro corporation, which states it in
     * place of the notes to its financial statements, § 264 (1) sentence 5 HGB. None for a fiscal year without one.
     * @param statement - The statement.
     * @param definition - The definition of its pdf.
     * @param context - The fiscal year.
     */
    updateReportDefinition(statement: BookkeepingStatement, definition: PdfDocumentDefinition, context: BookkeepingReportContext): void {
        const note: string | undefined = context.fiscalYear.balanceSheetNote?.trim();
        if (statement.form !== HGB_MICRO_BALANCE_SHEET.id || note == undefined || note === '') {
            return;
        }
        const content: PdfContentDefinition[] = Array.isArray(definition.content) ? definition.content : [definition.content];
        definition.content = [...content, { text: note, margin: [0, 20, 0, 0] }];
    }

    /**
     * Validates that the settings of a corporation name its company with its name, seat, register court and register
     * number, which its statements state, § 264 (1a) HGB.
     * @param settings - The settings about to be stored.
     * @param legalForm - A legal form of their history.
     * @throws A BadRequestError naming what is missing.
     */
    validateSettings(settings: BookkeepingSettingsCreateData, legalForm: string): void {
        const company: BookkeepingCompany | null | undefined = settings.company;
        const missing: string[] = [
            ['name', company?.name],
            ['seat', company?.seat],
            ['registerCourt', company?.registerCourt],
            ['registerNumber', company?.registerNumber]
        ].filter(([, value]) => value == undefined || value.trim() === '').map(([key]) => key ?? '');
        if (missing.length) {
            const named: string = missing.join(', ');
            throw new BadRequestError($ts`The bookkeeping settings of a ${legalForm} need the ${named} of its company, § 264 (1a) HGB.`);
        }
    }

    /**
     * Resolves the size class of a corporation on the balance sheet date of a fiscal year. It changes only when a
     * limit is crossed on two consecutive balance sheet dates. The first fiscal year of the books says whether the
     * company was founded in it, which classifies it by its own date alone, or the size class it had at the balance
     * sheet date before, which it keeps for that year.
     * @param fiscalYear - The fiscal year.
     * @param transaction - The transaction to read in, if any, such as the one of a closing.
     * @returns The size class.
     * @throws A ConflictError for a fiscal year needed without its average number of employees, one no thresholds
     * apply to, and a first fiscal year of the books that says neither or both.
     */
    async resolveSizeClass(fiscalYear: FiscalYear, transaction?: Transaction): Promise<HgbSizeClass> {
        const fiscalYears: FiscalYear[] = await this.fiscalYearRepository.findAll({
            where: { start: { beforeOrOn: fiscalYear.start } },
            order: { start: 'ASC' },
            limit: 'all',
            transaction
        });
        const figures: Map<string, Promise<SizeFigures>> = new Map();
        const figuresOf: (year: FiscalYear) => Promise<SizeFigures> = async year => {
            const known: Promise<SizeFigures> | undefined = figures.get(year.id);
            if (known != undefined) {
                return await known;
            }
            const resolved: Promise<SizeFigures> = this.resolveSizeFigures(year, transaction);
            figures.set(year.id, resolved);
            return await resolved;
        };
        // whether the corporation counts as above a limit on the date of a year: as it is on that date when it is on
        // the date before, and as it counted on the date before otherwise. Both dates are compared by the thresholds
        // of the year classified
        const isAbove: (index: number, limit: SizeLimit) => Promise<boolean> = async (index, limit) => {
            const year: FiscalYear | undefined = fiscalYears[index];
            if (year == undefined) {
                throw new InternalError('The fiscal year to classify is not one of the books.');
            }
            const thresholds: HgbSizeThreshold = this.resolveThresholds(year)[limit];
            const now: boolean = this.exceeds(await figuresOf(year), thresholds);
            const before: FiscalYear | undefined = fiscalYears[index - 1];
            if (before == undefined) {
                // the date before is not in the books: the class of a company founded in the year follows from its
                // own date, and a company that existed before keeps the class it had, as a change takes two dates
                return this.resolveStatusBefore(year, limit) ?? now;
            }
            if (now === this.exceeds(await figuresOf(before), thresholds)) {
                return now;
            }
            return await isAbove(index - 1, limit);
        };
        const index: number = fiscalYears.findIndex(y => y.id === fiscalYear.id);
        // one after the other, each reusing the figures the one before resolved
        for (const limit of LIMITS) {
            if (!await isAbove(index, limit)) {
                return limit === 'micro' ? HgbSizeClass.MICRO : limit === 'small' ? HgbSizeClass.SMALL : HgbSizeClass.MEDIUM;
            }
        }
        return HgbSizeClass.LARGE;
    }

    /**
     * Resolves whether a corporation counted as above a limit at the balance sheet date before the first fiscal year
     * of the books.
     * @param fiscalYear - The first fiscal year of the books.
     * @param limit - The limit.
     * @returns Whether it counted as above it by its `previousSizeClass`, or undefined for one `founded` in the year.
     * @throws A ConflictError for a fiscal year that says neither or both, or a size class that is none.
     */
    protected resolveStatusBefore(fiscalYear: FiscalYear, limit: SizeLimit): boolean | undefined {
        const [start, end] = [fiscalYear.start, fiscalYear.end].map(day => BookkeepingDayUtilities.formatDay(day));
        const classes: HgbSizeClass[] = Object.values(HgbSizeClass);
        const previous: HgbSizeClass | undefined = classes.find(c => c === fiscalYear.previousSizeClass);
        if (fiscalYear.founded === true && fiscalYear.previousSizeClass == undefined) {
            return undefined;
        }
        if (fiscalYear.founded !== true && previous != undefined) {
            // the classes in their order, each above the limits before it
            return classes.indexOf(previous) > LIMITS.indexOf(limit);
        }
        const sizeClasses: string = classes.join(', ');
        throw new ConflictError($ts`The first fiscal year of the books, from ${start} to ${end}, needs either founded, when the company was founded in it, or its previousSizeClass, one of ${sizeClasses}.`);
    }

    /**
     * Resolves what a corporation is classified by on the balance sheet date of a fiscal year: the balance sheet total
     * of its full balance sheet, the revenue of its full income statement, and its average number of employees.
     * @param fiscalYear - The fiscal year.
     * @param transaction - The transaction to read in, if any.
     * @returns The figures.
     * @throws A ConflictError for a fiscal year without its average number of employees.
     */
    protected async resolveSizeFigures(fiscalYear: FiscalYear, transaction?: Transaction): Promise<SizeFigures> {
        const employees: number = this.validateEmployees(fiscalYear);
        // one after the other, as the reads of one transaction run over one connection
        const balanceSheet: BookkeepingStatement = await this.reportService.resolveBalanceSheet(fiscalYear.id, HGB_BALANCE_SHEET.id, transaction);
        const incomeStatement: BookkeepingStatement = await this.reportService.resolveIncomeStatement(fiscalYear.id, HGB_INCOME_STATEMENT.id, transaction);
        const amountOf: (statement: BookkeepingStatement, id: string) => BigNumber = (statement, id) => {
            const position: BookkeepingStatementPosition | undefined = statement.positions.find(p => p.id === id);
            return position?.amount ?? new BigNumber(0);
        };
        return {
            // the assets, § 267 (4a) HGB
            balanceSheetTotal: amountOf(balanceSheet, 'assets'),
            revenue: amountOf(incomeStatement, 'income-statement.1'),
            employees
        };
    }

    /**
     * Resolves the thresholds that apply to a fiscal year: the latest valid from its start or before.
     * @param fiscalYear - The fiscal year.
     * @returns The thresholds.
     * @throws A ConflictError when none apply.
     */
    protected resolveThresholds(fiscalYear: FiscalYear): HgbSizeClassThresholds {
        const res: HgbSizeClassThresholds | undefined = this.thresholds
            .filter(t => t.validFrom.getTime() <= fiscalYear.start.getTime())
            .at(-1);
        if (res == undefined) {
            const start: string = BookkeepingDayUtilities.formatDay(fiscalYear.start);
            throw new ConflictError($ts`The size classes of § 267 HGB need thresholds valid for a fiscal year starting on ${start}.`);
        }
        return res;
    }

    /**
     * Whether figures exceed at least two of the three limits of a size class.
     * @param figures - The figures.
     * @param threshold - The limits.
     * @returns Whether they do.
     */
    protected exceeds(figures: SizeFigures, threshold: HgbSizeThreshold): boolean {
        const exceeded: boolean[] = [
            figures.balanceSheetTotal.isGreaterThan(threshold.balanceSheetTotal),
            figures.revenue.isGreaterThan(threshold.revenue),
            figures.employees > threshold.employees
        ];
        return exceeded.filter(Boolean).length >= 2;
    }

    /**
     * Validates that a fiscal year has its average number of employees.
     * @param fiscalYear - The fiscal year.
     * @returns The number.
     * @throws A ConflictError when it has none.
     */
    protected validateEmployees(fiscalYear: FiscalYear): number {
        if (fiscalYear.averageEmployees == undefined) {
            const start: string = BookkeepingDayUtilities.formatDay(fiscalYear.start);
            const end: string = BookkeepingDayUtilities.formatDay(fiscalYear.end);
            throw new ConflictError(
                $ts`The fiscal year from ${start} to ${end} needs its averageEmployees, the average number of employees the size class of § 267 HGB is resolved by.`
            );
        }
        return fiscalYear.averageEmployees;
    }
}
