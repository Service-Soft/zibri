
import { $t } from '../../../localization/translate.function';
import { type BookkeepingStatementStructure } from '../models/bookkeeping-statement-structure.model';
import { BookkeepingStatementType } from '../models/bookkeeping-statement-type.enum';
import { HGB_INCOME_STATEMENT } from './hgb-income-statement.model';

/**
 * The shortened income statement of a micro corporation (Kleinstkapitalgesellschaft), § 275 (5) HGB. The id of a
 * position is `micro-income-statement` followed by its number in § 275 (5), and each adds up positions of the full
 * income statement of § 275 (2) HGB.
 */
// what goes where follows the commentaries: the other income takes the change in inventories, the own work
// capitalized and the financial income, the depreciation takes the write-downs of financial assets, the other
// expenses take the interest, and the taxes take both kinds
export const HGB_MICRO_INCOME_STATEMENT: BookkeepingStatementStructure = {
    id: 'hgb.income-statement.micro',
    type: BookkeepingStatementType.INCOME_STATEMENT,
    label: HGB_INCOME_STATEMENT.label,
    positiveBalance: 'credit',
    rollsUpFrom: HGB_INCOME_STATEMENT.id,
    positions: [
        { id: 'micro-income-statement.1', label: $t`Revenue`, sums: ['income-statement.1'] },
        {
            id: 'micro-income-statement.2',
            label: $t`Other income`,
            sums: [
                'income-statement.2',
                'income-statement.3',
                'income-statement.4',
                'income-statement.9',
                'income-statement.10',
                'income-statement.11'
            ]
        },
        { id: 'micro-income-statement.3', label: $t`Cost of materials`, sums: ['income-statement.5'] },
        { id: 'micro-income-statement.4', label: $t`Personnel expenses`, sums: ['income-statement.6'] },
        { id: 'micro-income-statement.5', label: $t`Depreciation and amortization`, sums: ['income-statement.7', 'income-statement.12'] },
        { id: 'micro-income-statement.6', label: $t`Other expenses`, sums: ['income-statement.8', 'income-statement.13'] },
        { id: 'micro-income-statement.7', label: $t`Taxes`, sums: ['income-statement.14', 'income-statement.16'] },
        { id: 'micro-income-statement.8', label: $t`Net income or net loss for the year`, sums: ['income-statement.17'] }
    ],
    name: $t`Shortened income statement of a micro corporation (§ 275 (5) HGB)`
};