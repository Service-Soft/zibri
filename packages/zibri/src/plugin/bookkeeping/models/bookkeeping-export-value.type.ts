import { type BigNumber } from '../../../utilities/number.utilities';

/**
 * A value of a row of a table of the export: text for a text column, a number for a number column, a day for a day
 * column, or null for none.
 */
export type BookkeepingExportValue = string | number | BigNumber | Date | null;
