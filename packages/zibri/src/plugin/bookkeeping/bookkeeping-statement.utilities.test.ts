import { describe, expect, it } from '@jest/globals';

import { InternalError } from '../../error-handling/internal-error.model';
import { $t } from '../../localization/translate.function';
import { BigNumber } from '../../utilities/number.utilities';
import { BookkeepingStatementUtilities } from './bookkeeping-statement.utilities';
import { BookkeepingStatementType } from './models/bookkeeping-statement-type.enum';
import { type BookkeepingStatementStructure } from './models/bookkeeping-statement-structure.model';
import { HGB_STATEMENT_STRUCTURES } from './statements/hgb-statement-structures.model';

const CASH: BookkeepingStatementStructure = {
    id: 'cash.balance-sheet',
    type: BookkeepingStatementType.BALANCE_SHEET,
    label: $t`Balance sheet`,
    positiveBalance: 'debit',
    positions: [
        { id: 'cash.assets', label: $t`Assets`, positions: [{ id: 'cash.assets.bank', label: $t`Bank` }] },
        { id: 'cash.equity', label: $t`Equity`, positiveBalance: 'credit', positions: [{ id: 'cash.equity.capital', label: $t`Capital` }] }
    ]
};

describe('BookkeepingStatementUtilities', () => {
    it('holds the structures of the HGB together, with every position accounts are mapped to unique', () => {
        expect(() => BookkeepingStatementUtilities.validateStructures(HGB_STATEMENT_STRUCTURES)).not.toThrow();
        const positions: Map<string, BookkeepingStatementType> = BookkeepingStatementUtilities.resolveMappablePositions(HGB_STATEMENT_STRUCTURES);
        // 28 of the assets, 21 of the equity and liabilities, 18 of the income statement
        expect([...positions.values()].filter(t => t === BookkeepingStatementType.BALANCE_SHEET)).toHaveLength(49);
        expect([...positions.values()].filter(t => t === BookkeepingStatementType.INCOME_STATEMENT)).toHaveLength(18);
        expect(positions.has('assets.B.II')).toBe(false);
        expect(positions.has('income-statement.17')).toBe(false);
        expect(positions.has('micro-income-statement.1')).toBe(false);
    });

    it('refuses structures that do not hold together', () => {
        const twice: BookkeepingStatementStructure = { ...CASH, positions: [...CASH.positions, { id: 'cash.assets.bank', label: $t`Bank` }] };
        const unknownSum: BookkeepingStatementStructure = { ...CASH, positions: [...CASH.positions, { id: 'cash.total', label: $t`Total`, sums: ['cash.unknown'] }] };
        const cycle: BookkeepingStatementStructure = {
            ...CASH,
            positions: [{ id: 'cash.a', label: $t`Assets`, sums: ['cash.b'] }, { id: 'cash.b', label: $t`Bank`, sums: ['cash.a'] }]
        };
        const orphan: BookkeepingStatementStructure = { ...CASH, id: 'cash.balance-sheet.short', rollsUpFrom: 'cash.unknown', positions: [] };
        const result: BookkeepingStatementStructure = { ...CASH, resultPosition: 'cash.equity.result' };

        expect(() => BookkeepingStatementUtilities.validateStructures([CASH, CASH])).toThrow('The statement structure "cash.balance-sheet" is registered twice.');
        expect(() => BookkeepingStatementUtilities.validateStructures([twice])).toThrow('has the position "cash.assets.bank" twice');
        expect(() => BookkeepingStatementUtilities.validateStructures([unknownSum])).toThrow('sums "cash.unknown"');
        expect(() => BookkeepingStatementUtilities.validateStructures([cycle])).toThrow(InternalError);
        expect(() => BookkeepingStatementUtilities.validateStructures([CASH, orphan])).toThrow('needs to roll up from a full structure');
        expect(() => BookkeepingStatementUtilities.validateStructures([result])).toThrow('needs to be one of its positions');
        expect(() => BookkeepingStatementUtilities.validateStructures([CASH, ...HGB_STATEMENT_STRUCTURES])).not.toThrow();
    });

    it('finds the position of an account by the side of its balance', () => {
        const bank: { statementPosition: string, creditStatementPosition: string } = {
            statementPosition: 'assets.B.IV',
            creditStatementPosition: 'equity-and-liabilities.C.2'
        };

        expect(BookkeepingStatementUtilities.findPositionId(bank, new BigNumber('10.00'))).toBe('assets.B.IV');
        expect(BookkeepingStatementUtilities.findPositionId(bank, new BigNumber('-10.00'))).toBe('equity-and-liabilities.C.2');
        expect(BookkeepingStatementUtilities.findPositionId({ statementPosition: 'assets.B.IV', creditStatementPosition: null }, new BigNumber('-10.00')))
            .toBe('assets.B.IV');
        expect(BookkeepingStatementUtilities.findPositionId({ statementPosition: null }, new BigNumber('10.00'))).toBeUndefined();
    });
});
