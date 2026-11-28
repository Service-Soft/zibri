import { describe, expect, it } from '@jest/globals';

import { BigNumber } from '../../utilities/number.utilities';
import { JournalEntryUtilities } from './journal-entry.utilities';
import { type BookkeepingAccountBalance } from './models/bookkeeping-account-balance.model';
import { BookkeepingAccountType } from './models/bookkeeping-account-type.enum';
import { type BookkeepingAccount } from './models/bookkeeping-account.model';
import { type NewJournalEntryLine } from './models/new-journal-entry-line.model';

function account(number: string, type: BookkeepingAccountType): BookkeepingAccount {
    return { id: `account-${number}`, tenantId: 'tenant', number, name: number, type, statementPosition: null, closedAt: null };
}

function balance(of: BookkeepingAccount, debit: string, credit: string): BookkeepingAccountBalance {
    return { account: of, debit: new BigNumber(debit), credit: new BigNumber(credit) };
}

function describeLines(lines: NewJournalEntryLine[]): [string, string | undefined, string | undefined][] {
    return lines.map(l => [l.accountId, l.debit?.toFixed(2), l.credit?.toFixed(2)]);
}

const bank: BookkeepingAccount = account('1200', BookkeepingAccountType.ASSET);
const vat: BookkeepingAccount = account('3806', BookkeepingAccountType.LIABILITY);
const capital: BookkeepingAccount = account('2900', BookkeepingAccountType.EQUITY);
const result: BookkeepingAccount = account('2970', BookkeepingAccountType.EQUITY);
const revenue: BookkeepingAccount = account('8400', BookkeepingAccountType.REVENUE);
const rent: BookkeepingAccount = account('4210', BookkeepingAccountType.EXPENSE);

describe('JournalEntryUtilities', () => {
    // what validateLines refuses is in the cases of the books, whose messages need a started application
    it('takes lines whose debits add up to their credits', () => {
        const line = (debit: string | null, credit: string | null): NewJournalEntryLine => ({
            accountId: bank.id,
            debit: debit == undefined ? null : new BigNumber(debit),
            credit: credit == undefined ? null : new BigNumber(credit)
        });

        expect(() => JournalEntryUtilities.validateLines([line('119.00', null), line(null, '100'), line(null, '19')], 2, 'EUR')).not.toThrow();
        expect(() => JournalEntryUtilities.validateLines([line('1', null), line(null, '1')], 0, 'JPY')).not.toThrow();
    });

    it('mirrors the lines of an entry for its reversal', () => {
        const lines: NewJournalEntryLine[] = JournalEntryUtilities.resolveMirrorLines([
            { accountId: bank.id, debit: new BigNumber(119), credit: null },
            { accountId: revenue.id, debit: null, credit: new BigNumber(119) }
        ].map(l => ({ ...l, id: 'line', tenantId: 'tenant', entryId: 'entry', fiscalYearId: 'year', chainSequence: 1, chainHash: '', retainUntil: new Date(), archivedFiles: [] })));

        expect(describeLines(lines)).toEqual([[bank.id, undefined, '119.00'], [revenue.id, '119.00', undefined]]);
    });

    it('closes revenue and expenses into the result account, a profit on the credit side and a loss on the debit side', () => {
        const profit: NewJournalEntryLine[] = JournalEntryUtilities.resolveClosingLines(
            [balance(bank, '1190', '0'), balance(rent, '400', '0'), balance(revenue, '0', '1000')],
            result.id,
            []
        );
        const loss: NewJournalEntryLine[] = JournalEntryUtilities.resolveClosingLines([balance(rent, '400', '0'), balance(revenue, '50', '150')], result.id, []);
        const even: NewJournalEntryLine[] = JournalEntryUtilities.resolveClosingLines([balance(rent, '100', '0'), balance(revenue, '0', '100')], result.id, []);

        expect(describeLines(profit)).toEqual([[rent.id, undefined, '400.00'], [revenue.id, '1000.00', undefined], [result.id, undefined, '600.00']]);
        expect(describeLines(loss)).toEqual([[rent.id, undefined, '400.00'], [revenue.id, '100.00', undefined], [result.id, '300.00', undefined]]);
        expect(describeLines(even)).toEqual([[rent.id, undefined, '100.00'], [revenue.id, '100.00', undefined]]);
        expect(JournalEntryUtilities.resolveClosingLines([balance(bank, '5', '5')], result.id, [])).toEqual([]);
    });

    it('closes each account in the result position into the result account, beside the result', () => {
        // the allocation to the legal reserve of a UG, which appropriates part of the result within the equity
        const allocation: BookkeepingAccount = { ...account('2496', BookkeepingAccountType.EQUITY), statementPosition: 'equity-and-liabilities.A.V' };
        const reserve: BookkeepingAccount = { ...account('0846', BookkeepingAccountType.EQUITY), statementPosition: 'equity-and-liabilities.A.III.1' };
        const closing: NewJournalEntryLine[] = JournalEntryUtilities.resolveClosingLines(
            [balance(bank, '1000', '0'), balance(revenue, '0', '1000'), balance(allocation, '250', '0'), balance(reserve, '0', '250')],
            result.id,
            ['equity-and-liabilities.A.V']
        );

        expect(describeLines(closing)).toEqual([
            [revenue.id, '1000.00', undefined],
            [result.id, undefined, '1000.00'],
            [allocation.id, undefined, '250.00'],
            [result.id, '250.00', undefined]
        ]);
        // only the result carries the role
        expect(closing.map(l => 'role' in l ? l.role : undefined)).toEqual([undefined, 'result', undefined, undefined]);
    });

    it('opens a year with the balances of the balance sheet accounts after the closing, which balance', () => {
        const balances: BookkeepingAccountBalance[] = [
            balance(bank, '26190', '500'),
            balance(capital, '0', '25000'),
            balance(rent, '500', '0'),
            balance(revenue, '0', '1000'),
            balance(vat, '0', '190')
        ];
        const closing: NewJournalEntryLine[] = JournalEntryUtilities.resolveClosingLines(balances, result.id, []);

        const after: BookkeepingAccountBalance[] = JournalEntryUtilities.resolveBalancesAfter(balances, closing, new Map([[result.id, result]]));
        const opening: NewJournalEntryLine[] = JournalEntryUtilities.resolveOpeningLines(after);

        expect(describeLines(opening)).toEqual([
            [bank.id, '25690.00', undefined],
            [capital.id, undefined, '25000.00'],
            [result.id, undefined, '500.00'],
            [vat.id, undefined, '190.00']
        ]);
        expect(JournalEntryUtilities.resolveDebitTotal(opening).toFixed()).toBe(JournalEntryUtilities.resolveCreditTotal(opening).toFixed());
        expect(after.filter(b => b.account.type === BookkeepingAccountType.REVENUE || b.account.type === BookkeepingAccountType.EXPENSE)
            .every(b => b.debit.isEqualTo(b.credit))).toBe(true);
    });
});
