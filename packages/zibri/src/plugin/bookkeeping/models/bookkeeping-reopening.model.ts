import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type BookkeepingSettings } from './bookkeeping-settings.model';
import { type FiscalYear } from './fiscal-year.model';

/**
 * A fiscal year being reopened, as a conformance validates it: the settings of the books, the fiscal year as it was
 * closed, the legal form of the tenant at its end, whether it is reopened to correct accounts filed already, and the
 * transaction it is reopened in.
 */
export type BookkeepingReopening = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    settings: BookkeepingSettings,
    // eslint-disable-next-line jsdoc/require-jsdoc
    fiscalYear: FiscalYear,
    // eslint-disable-next-line jsdoc/require-jsdoc
    legalForm: string | undefined,
    // eslint-disable-next-line jsdoc/require-jsdoc
    forCorrection: boolean,
    // eslint-disable-next-line jsdoc/require-jsdoc
    transaction: Transaction
};
