import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { initDiContainer } from '../../../di/init-di-container.function';
import { GlobalRegistry } from '../../../global/global-registry';
import { BigNumber } from '../../../utilities/number.utilities';
import { BookkeepingAccountType } from '../models/bookkeeping-account-type.enum';
import { type BookkeepingAccount } from '../models/bookkeeping-account.model';
import { COMPANY } from './e-bilanz.cases';
import { EBilanzUtilities } from './e-bilanz.utilities';
import { type EBilanzAccountBalance } from './models/e-bilanz-account-balance.model';
import { EBilanzAccountingStandard } from './models/e-bilanz-accounting-standard.enum';
import { type EBilanzBooks } from './models/e-bilanz-books.model';
import { EBilanzIncomeStatementForm } from './models/e-bilanz-income-statement-form.enum';
import { type EBilanzPosition } from './models/e-bilanz-position.model';
import { type EBilanzPreparation } from './models/e-bilanz-preparation.model';
import { type EBilanzResultLine } from './models/e-bilanz-result-line.model';
import { EBilanzRevisionStatus } from './models/e-bilanz-revision-status.enum';
import { Hgb6EBilanzTaxonomyAdapter } from './services/hgb-6.e-bilanz-taxonomy-adapter';
import { HGB_TAXONOMY_6_9 } from './taxonomies/hgb-taxonomy-6-9.model';

function accountOf(number: string, name: string, type: BookkeepingAccountType, statementPosition: string): BookkeepingAccount {
    return { id: `account-${number}`, tenantId: 'tenant', number, name, type, statementPosition, creditStatementPosition: null, closedAt: null };
}

const BANK: BookkeepingAccount = accountOf('1200', 'Bank', BookkeepingAccountType.ASSET, 'assets.B.IV');
const CAPITAL: BookkeepingAccount = accountOf('0800', 'Share capital', BookkeepingAccountType.EQUITY, 'equity-and-liabilities.A.I');
const REVENUE: BookkeepingAccount = accountOf('8400', 'Revenue 19 %', BookkeepingAccountType.REVENUE, 'income-statement.1');
const CARRIED: BookkeepingAccount = accountOf('0860', 'Profit carried forward', BookkeepingAccountType.EQUITY, 'equity-and-liabilities.A.IV');
const RETAINED: BookkeepingAccount = accountOf('0870', 'Profit retained', BookkeepingAccountType.EQUITY, 'equity-and-liabilities.A.IV');

/**
 * What an account holds in the year.
 * @param account - The account.
 * @param debit - Its debits, those of the opening entry among them.
 * @param credit - Its credits, those of the opening entry among them.
 * @param openingDebit - The debit of the opening entry.
 * @param openingCredit - The credit of the opening entry.
 * @returns The balance.
 */
function balanceOf(account: BookkeepingAccount, debit: string, credit: string, openingDebit: string = '0', openingCredit: string = '0'): EBilanzAccountBalance {
    return {
        account,
        debit: new BigNumber(debit),
        credit: new BigNumber(credit),
        openingDebit: new BigNumber(openingDebit),
        openingCredit: new BigNumber(openingCredit)
    };
}

/**
 * The books of a GmbH with its capital of 25000.00 and a revenue of 10000.00 in the bank, closed with the result lines
 * given.
 * @param resultLines - The lines of the closing carrying the result into equity.
 * @returns The books.
 */
function booksOf(resultLines: EBilanzResultLine[]): EBilanzBooks {
    return {
        taxonomy: HGB_TAXONOMY_6_9,
        adapter: new Hgb6EBilanzTaxonomyAdapter(),
        fiscalYear: { id: 'fiscal-year', start: new Date('2026-01-01T00:00:00.000Z'), end: new Date('2026-12-31T00:00:00.000Z') },
        previousFiscalYear: undefined,
        company: COMPANY,
        accountingStandard: EBilanzAccountingStandard.UNIFIED,
        incomeStatementForm: EBilanzIncomeStatementForm.TOTAL_COST,
        revisionStatus: EBilanzRevisionStatus.ORIGINAL,
        balances: [balanceOf(BANK, '35000', '0'), balanceOf(CAPITAL, '0', '25000'), balanceOf(REVENUE, '0', '10000')],
        // the capital paid in, an entry of the year
        equityLines: [{ entryId: 'capital', accountId: CAPITAL.id, amount: new BigNumber('25000') }],
        legalReserveAllocationAccountId: undefined,
        resultLines,
        accountMappings: [],
        fixedAssets: [],
        statements: []
    };
}

function netIncomeOf(preparation: EBilanzPreparation): [string | undefined, [string, string][] | undefined] {
    const position: EBilanzPosition | undefined = preparation.content.positions.find(p => p.name === 'bs.eqLiab.equity.netIncome');
    return [position?.amount?.toFixed(2), position?.accounts.map(a => [a.number, a.balance.toFixed(2)])];
}

describe('the result of the year in the E-Bilanz', () => {
    it('lists the account the closing carries the result to under the result', () => {
        const preparation: EBilanzPreparation = EBilanzUtilities.resolvePreparation(booksOf([{ account: CARRIED, amount: new BigNumber('10000') }]));

        expect(preparation.findings).toStrictEqual([]);
        expect(netIncomeOf(preparation)).toStrictEqual(['10000.00', [['0860', '10000.00']]]);
    });

    it('lists each account a line of the closing carries part of the result to, with its part', () => {
        const preparation: EBilanzPreparation = EBilanzUtilities.resolvePreparation(booksOf([
            { account: CARRIED, amount: new BigNumber('6000') },
            { account: RETAINED, amount: new BigNumber('4000') }
        ]));

        expect(preparation.findings).toStrictEqual([]);
        expect(netIncomeOf(preparation)).toStrictEqual(['10000.00', [['0860', '6000.00'], ['0870', '4000.00']]]);
    });

    it('states the result without an account where the closing names none', () => {
        const preparation: EBilanzPreparation = EBilanzUtilities.resolvePreparation(booksOf([]));

        expect(preparation.findings).toStrictEqual([]);
        expect(netIncomeOf(preparation)).toStrictEqual(['10000.00', []]);
    });
});

function businessAssetComparisonOf(preparation: EBilanzPreparation): [string, string | undefined][] {
    return preparation.content.positions.filter(p => p.statement === 'businessAssetComparison').map(p => [p.name, p.amount?.toFixed(2)]);
}

describe('the steuerlicher Betriebsvermögensvergleich in the E-Bilanz', () => {
    // a finding is translated and its amounts formatted, which needs an application that exists
    beforeAll(() => {
        initDiContainer();
        GlobalRegistry.markAppAsCreated();
    });

    afterAll(() => {
        GlobalRegistry.markAppAsShuttingDown();
        GlobalRegistry.markAppAsOffline();
    });

    it('reads the equity before the year and the distribution of an account distributed in full', () => {
        // 4000.00 carried forward from the year before, and distributed: the account has no balance at the end
        const preparation: EBilanzPreparation = EBilanzUtilities.resolvePreparation({
            ...booksOf([{ account: CARRIED, amount: new BigNumber('10000') }]),
            previousFiscalYear: { start: new Date('2025-01-01T00:00:00.000Z'), end: new Date('2025-12-31T00:00:00.000Z') },
            balances: [
                balanceOf(BANK, '39000', '4000', '4000', '0'),
                balanceOf(CAPITAL, '0', '25000'),
                balanceOf(REVENUE, '0', '10000'),
                balanceOf(CARRIED, '4000', '4000', '0', '4000')
            ],
            equityLines: [
                { entryId: 'capital', accountId: CAPITAL.id, amount: new BigNumber('25000') },
                { entryId: 'distribution', accountId: CARRIED.id, amount: new BigNumber('-4000') }
            ]
        });

        expect(preparation.findings).toStrictEqual([]);
        expect(businessAssetComparisonOf(preparation)).toStrictEqual([
            ['BVV.profitLoss', '10000.00'],
            ['BVV.profitLoss.assetsCurrentYear', '35000.00'],
            ['BVV.profitLoss.assetsPreviousYear', '4000.00'],
            ['BVV.profitLoss.assetsPreviousYear.assets', '4000.00'],
            ['BVV.profitLoss.assetsPreviousYear.capAdjustments', '0.00'],
            ['BVV.profitLoss.withdrawalDistrib', '4000.00'],
            ['BVV.profitLoss.contribution', '25000.00']
        ]);
    });

    it('counts an entry within the equity as neither a contribution nor a distribution, and nets the lines of each entry', () => {
        const preparation: EBilanzPreparation = EBilanzUtilities.resolvePreparation({
            ...booksOf([{ account: CARRIED, amount: new BigNumber('10000') }]),
            balances: [
                balanceOf(BANK, '35000', '0'),
                balanceOf(CAPITAL, '0', '25000'),
                balanceOf(REVENUE, '0', '10000'),
                balanceOf(RETAINED, '1000', '1000')
            ],
            equityLines: [
                // the capital paid in, in two lines of one entry
                { entryId: 'capital', accountId: CAPITAL.id, amount: new BigNumber('20000') },
                { entryId: 'capital', accountId: CAPITAL.id, amount: new BigNumber('5000') },
                // moved from one account of the equity to the other and back
                { entryId: 'transfer', accountId: RETAINED.id, amount: new BigNumber('1000') },
                { entryId: 'transfer', accountId: RETAINED.id, amount: new BigNumber('-1000') }
            ]
        });

        expect(preparation.findings).toStrictEqual([]);
        expect(businessAssetComparisonOf(preparation).filter(([name]) => name.endsWith('withdrawalDistrib') || name.endsWith('contribution')))
            .toStrictEqual([['BVV.profitLoss.withdrawalDistrib', '0.00'], ['BVV.profitLoss.contribution', '25000.00']]);
    });

    it('names a result other than that of the income statement, as where an entry on the equity is not read', () => {
        const preparation: EBilanzPreparation = EBilanzUtilities.resolvePreparation({ ...booksOf([{ account: CARRIED, amount: new BigNumber('10000') }]), equityLines: [] });

        expect(preparation.findings).toStrictEqual([
            {
                position: 'BVV.profitLoss',
                message: 'The position "Jahresüberschuss/-fehlbetrag (BVV)" of the comparison of business assets states €35,000.00 and needs to equal '
                    + 'the result of the income statement, €10,000.00: check the positions the accounts of the equity are mapped to.'
            }
        ]);
    });
});