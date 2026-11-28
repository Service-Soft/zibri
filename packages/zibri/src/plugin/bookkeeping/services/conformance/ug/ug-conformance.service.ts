/* eslint-disable cspell/spellchecker */
import { Repository } from '../../../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../../di/inject.function';
import { ConflictError } from '../../../../../error-handling/errors/conflict.error';
import { $ts } from '../../../../../localization/translate.function';
import { BigNumber, NumberUtilities } from '../../../../../utilities/number.utilities';
import { BookkeepingDayUtilities } from '../../../bookkeeping-day.utilities';
import { BookkeepingStatementUtilities } from '../../../bookkeeping-statement.utilities';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../../../bookkeeping.tokens';
import { type BookkeepingAccountBalance } from '../../../models/bookkeeping-account-balance.model';
import { BookkeepingAccount } from '../../../models/bookkeeping-account.model';
import { type BookkeepingClosing } from '../../../models/bookkeeping-closing.model';
import { type BookkeepingReportContext } from '../../../models/bookkeeping-report-context.model';
import { type FiscalYear } from '../../../models/fiscal-year.model';
import { type NewJournalEntry } from '../../../models/new-journal-entry.model';
import { type PostingRuleSet } from '../../../models/posting-rule-set.model';
import { type PostingRules } from '../../../models/posting-rules.model';
import { type BookkeepingConformance, type BookkeepingConformanceServiceInterface } from '../bookkeeping-conformance-service.interface';
import { type UgLegalReserve } from './ug-legal-reserve.model';

/**
 * The accounts the legal reserve of a fiscal year is posted on, by the posting rules valid at its end.
 */
type ReserveAccounts = {
    /**
     * The id of the equity account of the legal reserve, credited.
     */
    legalReserveAccountId: string,
    /**
     * The id of the equity account the reserve is taken from, debited.
     */
    reserveAllocationAccountId: string
};

/**
 * Holds the books of a UG (haftungsbeschränkt) to § 5a (3) GmbHG: a quarter of the net income of each fiscal year,
 * less a loss carried forward from the year before, goes into the legal reserve, on the accounts the posting rules of
 * the year name. Proposes the entry at closing, refuses the closing until it is posted, and refuses posting rules
 * without those accounts. A fiscal year at whose end the tenant is a GmbH has no such reserve.
 */
@Injectable({ register: 'onUse' })
export class UgConformanceService implements BookkeepingConformanceServiceInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: BookkeepingConformance = 'ug-legal-reserve';

    /**
     * The positions of the balance sheet a loss carried forward is read from, in the balances the year starts with:
     * the profit or loss carried forward, and the net income or loss of the year before.
     */
    protected readonly carriedForwardPositions: string[] = ['equity-and-liabilities.A.IV', 'equity-and-liabilities.A.V'];

    private get accountRepository(): Repository<BookkeepingAccount> {
        return inject(repositoryTokenFor(BookkeepingAccount));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    isApplicable(legalForm: string): boolean {
        return legalForm === 'UG';
    }

    /**
     * Validates that posting rules of a UG name the accounts its legal reserve is posted on.
     * @param rules - The rules.
     * @param context - The fiscal year of the rules.
     * @throws A ConflictError naming what is missing.
     */
    validatePostingRules(rules: PostingRules, context: BookkeepingReportContext): void {
        this.resolveAccounts(rules, context.fiscalYear);
    }

    /**
     * Proposes the entry of what the legal reserve still needs: the allocation account debited, the legal reserve
     * credited, on the last day of the year.
     * @param closing - The fiscal year about to be closed.
     * @returns The entry, or none when the reserve is posted or the year needs none.
     */
    async resolveClosingProposals(closing: BookkeepingClosing): Promise<NewJournalEntry[]> {
        const reserve: UgLegalReserve = await this.resolveLegalReserve(closing);
        const missing: BigNumber = NumberUtilities.subtract(reserve.reserve, reserve.posted);
        if (!missing.isGreaterThan(0)) {
            return [];
        }
        const accounts: ReserveAccounts = this.resolveAccounts(await this.findRules(closing.fiscalYear), closing.fiscalYear);
        return [{
            documentDate: closing.fiscalYear.end,
            postingDate: closing.fiscalYear.end,
            documentReference: null,
            text: $ts`Legal reserve of § 5a (3) GmbHG`,
            lines: [
                { accountId: accounts.reserveAllocationAccountId, debit: missing, credit: null },
                { accountId: accounts.legalReserveAccountId, debit: null, credit: missing }
            ]
        }];
    }

    /**
     * Validates that the legal reserve of the year is posted.
     * @param closing - The fiscal year about to be closed.
     * @throws A ConflictError saying what still needs to be posted.
     */
    async validateClosing(closing: BookkeepingClosing): Promise<void> {
        const reserve: UgLegalReserve = await this.resolveLegalReserve(closing);
        const missing: BigNumber = NumberUtilities.subtract(reserve.reserve, reserve.posted);
        if (missing.isGreaterThan(0)) {
            const amount: string = missing.toFixed();
            const currency: string = closing.settings.currency;
            const accounts: ReserveAccounts = this.resolveAccounts(await this.findRules(closing.fiscalYear), closing.fiscalYear);
            const account: BookkeepingAccount = await this.accountRepository.findById(accounts.legalReserveAccountId, { transaction: closing.transaction });
            throw new ConflictError([
                $ts`The legal reserve of § 5a (3) GmbHG needs ${amount} ${currency} more on the account ${account.number} before the fiscal year is closed.`,
                $ts`Post the entry its closing proposals answer.`
            ]);
        }
    }

    /**
     * Resolves the legal reserve of a fiscal year: a quarter of its net income less the loss carried forward from the
     * year before, rounded up, and what is posted to the reserve in the year.
     * @param closing - The fiscal year.
     * @returns The reserve.
     * @throws A ConflictError when a reserve is due and the posting rules of the year name no accounts of it.
     */
    async resolveLegalReserve(closing: BookkeepingClosing): Promise<UgLegalReserve> {
        const surplus: BigNumber = BookkeepingStatementUtilities.resolveResult(closing.balances);
        const opening: BookkeepingAccountBalance[] = await this.resolveOpeningBalances(closing);
        const carriedForward: BigNumber = opening
            .filter(b => {
                const position: string | undefined = BookkeepingStatementUtilities.findPositionId(b.account, NumberUtilities.subtract(b.debit, b.credit));
                return position != undefined && this.carriedForwardPositions.includes(position);
            })
            .reduce((sum, b) => NumberUtilities.add(sum, NumberUtilities.subtract(b.credit, b.debit)), new BigNumber(0));
        const lossCarriedForward: BigNumber = carriedForward.isLessThan(0) ? carriedForward.negated() : new BigNumber(0);
        const base: BigNumber = NumberUtilities.subtract(surplus, lossCarriedForward);
        const minorUnits: number = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).getCurrencyMinorUnits(closing.settings.currency);
        // up rather than to the nearest: the reserve is at least the quarter
        const reserve: BigNumber = base.isGreaterThan(0)
            ? NumberUtilities.multiply(base, 0.25).decimalPlaces(minorUnits, BigNumber.ROUND_UP)
            : new BigNumber(0);
        const rules: PostingRules | undefined = await this.findRules(closing.fiscalYear);
        if (reserve.isZero() && rules?.legalReserveAccountId == undefined) {
            return { surplus, lossCarriedForward, reserve, posted: new BigNumber(0) };
        }
        const { legalReserveAccountId } = this.resolveAccounts(rules, closing.fiscalYear);
        const net: (b: BookkeepingAccountBalance | undefined) => BigNumber = b => b == undefined ? new BigNumber(0) : NumberUtilities.subtract(b.credit, b.debit);
        const posted: BigNumber = NumberUtilities.subtract(
            net(closing.balances.find(b => b.account.id === legalReserveAccountId)),
            net(opening.find(b => b.account.id === legalReserveAccountId))
        );
        return { surplus, lossCarriedForward, reserve, posted };
    }

    /**
     * Finds the posting rules valid at the end of a fiscal year: those of its rule set valid from the latest day.
     * @param fiscalYear - The fiscal year.
     * @returns The rules, or undefined for a fiscal year without.
     */
    protected async findRules(fiscalYear: FiscalYear): Promise<PostingRules | undefined> {
        const ruleSets: PostingRuleSet[] = await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_RULE_SERVICE).findRuleSets(fiscalYear.id);
        return ruleSets.at(-1)?.rules;
    }

    /**
     * Resolves the accounts the legal reserve is posted on from posting rules.
     * @param rules - The rules, or undefined for none.
     * @param fiscalYear - Their fiscal year.
     * @returns The accounts.
     * @throws A ConflictError for rules that do not name both.
     */
    protected resolveAccounts(rules: PostingRules | undefined, fiscalYear: FiscalYear): ReserveAccounts {
        if (rules?.legalReserveAccountId == undefined || rules.reserveAllocationAccountId == undefined) {
            const [start, end] = [fiscalYear.start, fiscalYear.end].map(day => BookkeepingDayUtilities.formatDay(day));
            throw new ConflictError(
                $ts`The posting rules of the fiscal year from ${start} to ${end} need to name the legalReserveAccountId and the reserveAllocationAccountId of the legal reserve of § 5a (3) GmbHG.`
            );
        }
        return { legalReserveAccountId: rules.legalReserveAccountId, reserveAllocationAccountId: rules.reserveAllocationAccountId };
    }

    /**
     * Resolves the balances the fiscal year starts with: those its opening entry carries from the closing of the year
     * before, and those carried over by hand against a carry-forward account.
     * @param closing - The fiscal year.
     * @returns The balance of each account carried in, none without.
     */
    protected async resolveOpeningBalances(closing: BookkeepingClosing): Promise<BookkeepingAccountBalance[]> {
        return (await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE).resolveCarriedBalances(closing.fiscalYear.id, closing.transaction)).balances;
    }
}
