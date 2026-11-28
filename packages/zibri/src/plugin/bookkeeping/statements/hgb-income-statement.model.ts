/* eslint-disable cspell/spellchecker */
import { $t } from '../../../localization/translate.function';
import { type BookkeepingStatementStructure } from '../models/bookkeeping-statement-structure.model';
import { BookkeepingStatementType } from '../models/bookkeeping-statement-type.enum';

/**
 * The full income statement of a corporation by the nature of expense method, § 275 (2) HGB. The id of a position is
 * `income-statement` followed by the numbering of the HGB, such as `income-statement.5.a`. Income counts positive
 * and expenses negative, so `income-statement.15`, the result after taxes, and `income-statement.17`, the net income
 * or net loss for the year, add up the positions before them.
 */
// the labels are the wording of the HGB, in German in de.xlf, without its remarks ("davon ...")
export const HGB_INCOME_STATEMENT: BookkeepingStatementStructure = {
    id: 'hgb.income-statement',
    type: BookkeepingStatementType.INCOME_STATEMENT,
    label: $t`Income statement`,
    positiveBalance: 'credit',
    positions: [
        { id: 'income-statement.1', label: $t`Revenue` },
        { id: 'income-statement.2', label: $t`Increase or decrease in finished goods and work in progress` },
        { id: 'income-statement.3', label: $t`Other own work capitalized` },
        { id: 'income-statement.4', label: $t`Other operating income` },
        {
            id: 'income-statement.5',
            label: $t`Cost of materials`,
            positions: [
                { id: 'income-statement.5.a', label: $t`Cost of raw materials, supplies and purchased merchandise` },
                { id: 'income-statement.5.b', label: $t`Cost of purchased services` }
            ]
        },
        {
            id: 'income-statement.6',
            label: $t`Personnel expenses`,
            positions: [
                { id: 'income-statement.6.a', label: $t`Wages and salaries` },
                { id: 'income-statement.6.b', label: $t`Social security, pension and other benefit costs` }
            ]
        },
        {
            id: 'income-statement.7',
            label: $t`Depreciation and amortization`,
            positions: [
                { id: 'income-statement.7.a', label: $t`On intangible assets and tangible assets` },
                {
                    id: 'income-statement.7.b',
                    label: $t`On current assets, to the extent they exceed the depreciation usual in the corporation`
                }
            ]
        },
        { id: 'income-statement.8', label: $t`Other operating expenses` },
        { id: 'income-statement.9', label: $t`Income from participations` },
        { id: 'income-statement.10', label: $t`Income from other securities and long-term loans` },
        { id: 'income-statement.11', label: $t`Other interest and similar income` },
        { id: 'income-statement.12', label: $t`Write-downs of financial assets and of current securities` },
        { id: 'income-statement.13', label: $t`Interest and similar expenses` },
        { id: 'income-statement.14', label: $t`Taxes on income` },
        {
            id: 'income-statement.15',
            label: $t`Result after taxes`,
            sums: [
                'income-statement.1',
                'income-statement.2',
                'income-statement.3',
                'income-statement.4',
                'income-statement.5',
                'income-statement.6',
                'income-statement.7',
                'income-statement.8',
                'income-statement.9',
                'income-statement.10',
                'income-statement.11',
                'income-statement.12',
                'income-statement.13',
                'income-statement.14'
            ]
        },
        { id: 'income-statement.16', label: $t`Other taxes` },
        {
            id: 'income-statement.17',
            label: $t`Net income or net loss for the year`,
            sums: ['income-statement.15', 'income-statement.16']
        }
    ],
    name: $t`Income statement by the nature of expense method (§ 275 (2) HGB)`
};