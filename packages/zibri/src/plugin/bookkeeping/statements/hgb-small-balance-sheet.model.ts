import { $t } from '../../../localization/translate.function';
import { BookkeepingStatementUtilities } from '../bookkeeping-statement.utilities';
import { BookkeepingStatementType } from '../models/bookkeeping-statement-type.enum';
import { type BookkeepingStatementStructure } from '../models/bookkeeping-statement-structure.model';
import { HGB_BALANCE_SHEET } from './hgb-balance-sheet.model';

/**
 * The shortened balance sheet of a small corporation, § 266 (1) sentence 3 HGB: the positions of the full balance
 * sheet with letters and Roman numerals, each the sum of the full position of the same id.
 */
export const HGB_SMALL_BALANCE_SHEET: BookkeepingStatementStructure = {
    id: 'hgb.balance-sheet.small',
    type: BookkeepingStatementType.BALANCE_SHEET,
    label: HGB_BALANCE_SHEET.label,
    name: $t`Shortened balance sheet of a small corporation (§ 266 (1) sentence 3 HGB)`,
    positiveBalance: 'debit',
    rollsUpFrom: HGB_BALANCE_SHEET.id,
    positions: [
        BookkeepingStatementUtilities.resolveRolledUpPosition(HGB_BALANCE_SHEET, 'assets', [
            BookkeepingStatementUtilities.resolveRolledUpPosition(HGB_BALANCE_SHEET, 'assets.A', ['assets.A.I', 'assets.A.II', 'assets.A.III']
                .map(id => BookkeepingStatementUtilities.resolveRolledUpPosition(HGB_BALANCE_SHEET, id))),
            BookkeepingStatementUtilities.resolveRolledUpPosition(HGB_BALANCE_SHEET, 'assets.B', ['assets.B.I', 'assets.B.II', 'assets.B.III', 'assets.B.IV']
                .map(id => BookkeepingStatementUtilities.resolveRolledUpPosition(HGB_BALANCE_SHEET, id))),
            ...['assets.C', 'assets.D', 'assets.E'].map(id => BookkeepingStatementUtilities.resolveRolledUpPosition(HGB_BALANCE_SHEET, id))
        ]),
        BookkeepingStatementUtilities.resolveRolledUpPosition(HGB_BALANCE_SHEET, 'equity-and-liabilities', [
            BookkeepingStatementUtilities.resolveRolledUpPosition(
                HGB_BALANCE_SHEET,
                'equity-and-liabilities.A',
                [
                    'equity-and-liabilities.A.I',
                    'equity-and-liabilities.A.II',
                    'equity-and-liabilities.A.III',
                    'equity-and-liabilities.A.IV',
                    'equity-and-liabilities.A.V'
                ].map(id => BookkeepingStatementUtilities.resolveRolledUpPosition(HGB_BALANCE_SHEET, id))
            ),
            ...['equity-and-liabilities.B', 'equity-and-liabilities.C', 'equity-and-liabilities.D', 'equity-and-liabilities.E']
                .map(id => BookkeepingStatementUtilities.resolveRolledUpPosition(HGB_BALANCE_SHEET, id))
        ])
    ]
};
