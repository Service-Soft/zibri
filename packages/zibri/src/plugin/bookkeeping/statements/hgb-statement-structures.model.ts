import { type BookkeepingStatementStructure } from '../models/bookkeeping-statement-structure.model';
import { HGB_BALANCE_SHEET } from './hgb-balance-sheet.model';
import { HGB_INCOME_STATEMENT } from './hgb-income-statement.model';
import { HGB_MICRO_BALANCE_SHEET } from './hgb-micro-balance-sheet.model';
import { HGB_MICRO_INCOME_STATEMENT } from './hgb-micro-income-statement.model';
import { HGB_SMALL_BALANCE_SHEET } from './hgb-small-balance-sheet.model';

/**
 * The statement structures of the HGB, which `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.STATEMENT_STRUCTURES` holds by
 * default: the full balance sheet and income statement, and the shortened forms of small and micro corporations.
 */
export const HGB_STATEMENT_STRUCTURES: BookkeepingStatementStructure[] = [
    HGB_BALANCE_SHEET,
    HGB_SMALL_BALANCE_SHEET,
    HGB_MICRO_BALANCE_SHEET,
    HGB_INCOME_STATEMENT,
    HGB_MICRO_INCOME_STATEMENT
];