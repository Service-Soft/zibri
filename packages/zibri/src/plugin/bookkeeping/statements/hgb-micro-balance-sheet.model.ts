import { $t } from '../../../localization/translate.function';
import { BookkeepingStatementUtilities } from '../bookkeeping-statement.utilities';
import { BookkeepingStatementType } from '../models/bookkeeping-statement-type.enum';
import { type BookkeepingStatementStructure } from '../models/bookkeeping-statement-structure.model';
import { HGB_BALANCE_SHEET } from './hgb-balance-sheet.model';

/**
 * The shortened balance sheet of a micro corporation (Kleinstkapitalgesellschaft), § 266 (1) sentence 4 HGB: the
 * positions of the full balance sheet with letters, each the sum of the full position of the same id.
 */
export const HGB_MICRO_BALANCE_SHEET: BookkeepingStatementStructure = {
    id: 'hgb.balance-sheet.micro',
    type: BookkeepingStatementType.BALANCE_SHEET,
    label: HGB_BALANCE_SHEET.label,
    name: $t`Shortened balance sheet of a micro corporation (§ 266 (1) sentence 4 HGB)`,
    positiveBalance: 'debit',
    rollsUpFrom: HGB_BALANCE_SHEET.id,
    positions: ['assets', 'equity-and-liabilities'].map(side => BookkeepingStatementUtilities.resolveRolledUpPosition(
        HGB_BALANCE_SHEET,
        side,
        ['A', 'B', 'C', 'D', 'E'].map(letter => BookkeepingStatementUtilities.resolveRolledUpPosition(HGB_BALANCE_SHEET, `${side}.${letter}`))
    ))
};
