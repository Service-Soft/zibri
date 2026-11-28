import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { $ts } from '../../localization/translate.function';
import { BigNumber, NumberUtilities } from '../../utilities/number.utilities';
import { type BookedJournalEntryLine } from './models/booked-journal-entry-line.model';
import { type BookkeepingAccountBalance } from './models/bookkeeping-account-balance.model';
import { BookkeepingAccountType } from './models/bookkeeping-account-type.enum';
import { type BookkeepingAccount } from './models/bookkeeping-account.model';
import { BookkeepingLimits } from './models/bookkeeping-limits.model';
import { type ClosingJournalEntryLine } from './models/closing-journal-entry-line.model';
import { JournalEntryLineRole } from './models/journal-entry-line-role.enum';
import { type NewJournalEntryLine } from './models/new-journal-entry-line.model';

/**
 * The account types of the balance sheet, whose balances a fiscal year carries into the next one.
 */
const BALANCE_SHEET_TYPES: BookkeepingAccountType[] = [
    BookkeepingAccountType.ASSET,
    BookkeepingAccountType.LIABILITY,
    BookkeepingAccountType.EQUITY
];

/**
 * The account types of the income statement, which closing a fiscal year carries into equity.
 */
const INCOME_STATEMENT_TYPES: BookkeepingAccountType[] = [BookkeepingAccountType.REVENUE, BookkeepingAccountType.EXPENSE];

/**
 * The lines of journal entries: what a valid entry holds, what the lines of a fiscal year add up to, and the lines of
 * the entries a reversal and a closing post.
 */
export abstract class JournalEntryUtilities {
    /**
     * Validates the lines of an entry: at least two, each with an amount above 0 on exactly one side, with at most the
     * minor units of the currency, and debits that add up to the credits.
     * @param lines - The lines.
     * @param minorUnits - How many decimals an amount of the currency has.
     * @param currency - The currency, for the messages.
     * @throws A BadRequestError saying what the first line that does not hold needs to be.
     */
    static validateLines(lines: BookedJournalEntryLine[], minorUnits: number, currency: string): void {
        if (lines.length < 2) {
            throw new BadRequestError($ts`A journal entry needs to have at least 2 lines.`);
        }
        if (lines.length > BookkeepingLimits.LINES_MAX_COUNT) {
            throw new BadRequestError($ts`A journal entry needs to have at most ${BookkeepingLimits.LINES_MAX_COUNT} lines.`);
        }
        for (const [index, line] of lines.entries()) {
            const position: number = index + 1;
            const amount: BigNumber | undefined = this.findAmount(line);
            if (amount == undefined) {
                throw new BadRequestError($ts`Line ${position} needs to have either a debit or a credit.`);
            }
            if (!amount.isFinite() || !amount.isGreaterThan(0)) {
                throw new BadRequestError($ts`The amount of line ${position} needs to be above 0.`);
            }
            if ((amount.decimalPlaces() ?? 0) > minorUnits) {
                throw new BadRequestError(
                    $ts`The amount of line ${position} needs to have at most ${minorUnits} decimals, the minor units of ${currency}.`
                );
            }
        }
        const debit: BigNumber = this.resolveDebitTotal(lines);
        const credit: BigNumber = this.resolveCreditTotal(lines);
        if (NumberUtilities.compare(debit, credit) !== 0) {
            throw new BadRequestError(
                $ts`The debits of the entry, ${debit.toFixed(minorUnits)}, need to add up to its credits, ${credit.toFixed(minorUnits)}.`
            );
        }
    }

    /**
     * Resolves the sum of the debits of lines.
     * @param lines - The lines.
     * @returns The sum.
     */
    static resolveDebitTotal(lines: BookedJournalEntryLine[]): BigNumber {
        return lines.reduce((sum, line) => line.debit == undefined ? sum : NumberUtilities.add(sum, line.debit), new BigNumber(0));
    }

    /**
     * Resolves the sum of the credits of lines.
     * @param lines - The lines.
     * @returns The sum.
     */
    static resolveCreditTotal(lines: BookedJournalEntryLine[]): BigNumber {
        return lines.reduce((sum, line) => line.credit == undefined ? sum : NumberUtilities.add(sum, line.credit), new BigNumber(0));
    }

    /**
     * Resolves the lines of the reversal of an entry: the same accounts and amounts, with debit and credit swapped.
     * @param lines - The lines of the entry, posted or about to be.
     * @returns The lines of the reversal.
     */
    static resolveMirrorLines(lines: NewJournalEntryLine[]): NewJournalEntryLine[] {
        return lines.map(line => ({ accountId: line.accountId, debit: line.credit ?? null, credit: line.debit ?? null }));
    }

    /**
     * Resolves the balances after further lines are booked on them.
     * @param balances - The balances.
     * @param lines - The lines booked.
     * @param accounts - The accounts the lines are booked on, by id.
     * @returns The balances, by the number of their account.
     */
    static resolveBalancesAfter(
        balances: BookkeepingAccountBalance[],
        lines: BookedJournalEntryLine[],
        accounts: Map<string, BookkeepingAccount>
    ): BookkeepingAccountBalance[] {
        const res: Map<string, BookkeepingAccountBalance> = new Map(balances.map(balance => [balance.account.id, { ...balance }]));
        for (const line of lines) {
            const account: BookkeepingAccount | undefined = accounts.get(line.accountId) ?? res.get(line.accountId)?.account;
            if (account == undefined) {
                continue;
            }
            const balance: BookkeepingAccountBalance = res.get(account.id)
                ?? { account, debit: new BigNumber(0), credit: new BigNumber(0) };
            res.set(account.id, {
                account,
                debit: line.debit == undefined ? balance.debit : NumberUtilities.add(balance.debit, line.debit),
                credit: line.credit == undefined ? balance.credit : NumberUtilities.add(balance.credit, line.credit)
            });
        }
        return this.sortBalances([...res.values()]);
    }

    /**
     * Sorts balances by the number of their account.
     * @param balances - The balances.
     * @returns The balances, sorted.
     */
    static sortBalances(balances: BookkeepingAccountBalance[]): BookkeepingAccountBalance[] {
        return [...balances].sort((a, b) => a.account.number.localeCompare(b.account.number, 'en', { numeric: true }));
    }

    /**
     * Resolves the lines of the entry closing a fiscal year: each revenue and expense account booked back to zero,
     * and what they leave, the result of the year, on the result account, the line with the role `RESULT`. Each other
     * account in the position of the balance sheet the result is part of, such as the allocation to the legal reserve
     * appropriating part of it, is booked back to zero into the result account too, in a line of its own.
     * @param balances - The balances of the fiscal year.
     * @param resultAccountId - The id of the equity account the result is carried into.
     * @param resultPositions - The positions of the full balance sheets the result of the year is part of, such as
     * `equity-and-liabilities.A.V`.
     * @returns The lines, none for a year without revenue, expenses or an account appropriating the result.
     */
    static resolveClosingLines(
        balances: BookkeepingAccountBalance[],
        resultAccountId: string,
        resultPositions: readonly string[]
    ): ClosingJournalEntryLine[] {
        const res: ClosingJournalEntryLine[] = this.resolveLinesToZero(
            balances.filter(b => INCOME_STATEMENT_TYPES.includes(b.account.type))
        );
        // what the income statement accounts leave on the debit side: a loss, on the credit side: a profit
        const result: BigNumber = NumberUtilities.subtract(this.resolveCreditTotal(res), this.resolveDebitTotal(res));
        if (!result.isZero()) {
            res.push({ ...this.resolveLine(resultAccountId, result), role: JournalEntryLineRole.RESULT });
        }
        // the result position starts each year at 0, so the accounts appropriating the result of the year end in the
        // profit carried forward with it, as the appropriation of profits ends in the balance sheet profit: carried
        // forward, an allocation of the year before would be stated as one of the year after
        const appropriating: NewJournalEntryLine[] = this.resolveLinesToZero(balances.filter(b => b.account.id !== resultAccountId
            && BALANCE_SHEET_TYPES.includes(b.account.type)
            && [b.account.statementPosition, b.account.creditStatementPosition].some(p => p != undefined && resultPositions.includes(p))));
        const appropriated: BigNumber = NumberUtilities.subtract(
            this.resolveCreditTotal(appropriating),
            this.resolveDebitTotal(appropriating)
        );
        if (appropriating.length) {
            res.push(...appropriating, ...appropriated.isZero() ? [] : [this.resolveLine(resultAccountId, appropriated)]);
        }
        return res;
    }

    /**
     * Resolves the lines of the entry opening a fiscal year: the balance of each balance sheet account at the end of
     * the year before, on the side it is on.
     * @param balances - The balances at the end of the year before, after its closing entry.
     * @returns The lines, none when every balance is zero.
     */
    static resolveOpeningLines(balances: BookkeepingAccountBalance[]): NewJournalEntryLine[] {
        return balances
            .filter(b => BALANCE_SHEET_TYPES.includes(b.account.type))
            .map(b => ({ accountId: b.account.id, net: NumberUtilities.subtract(b.debit, b.credit) }))
            .filter(b => !b.net.isZero())
            .map(b => this.resolveLine(b.accountId, b.net));
    }

    /**
     * Resolves the lines booking accounts to zero: each balance on the side opposite to it.
     * @param balances - The balances.
     * @returns The lines, one per balance that is not zero.
     */
    private static resolveLinesToZero(balances: BookkeepingAccountBalance[]): NewJournalEntryLine[] {
        return balances
            .map(b => ({ accountId: b.account.id, net: NumberUtilities.subtract(b.credit, b.debit) }))
            .filter(b => !b.net.isZero())
            .map(b => this.resolveLine(b.accountId, b.net));
    }

    /**
     * Resolves a line of a signed amount: on the debit side when it is above 0, on the credit side below.
     * @param accountId - The account.
     * @param amount - The amount, above 0 for a debit.
     * @returns The line.
     */
    private static resolveLine(accountId: string, amount: BigNumber): NewJournalEntryLine {
        return amount.isGreaterThan(0)
            ? { accountId, debit: amount, credit: null }
            : { accountId, debit: null, credit: amount.negated() };
    }

    /**
     * Finds the amount of a line: its debit or its credit, when it has exactly one of them.
     * @param line - The line.
     * @returns The amount, or undefined for a line with both or neither.
     */
    private static findAmount(line: BookedJournalEntryLine): BigNumber | undefined {
        return (line.debit == undefined) === (line.credit == undefined) ? undefined : line.debit ?? line.credit ?? undefined;
    }
}