import { type BookkeepingCompanyModel } from './bookkeeping-company.model';
import { type BookkeepingLegalFormModel } from './bookkeeping-legal-form.model';

/**
 * A change of the settings of the books of a tenant, as `PATCH /bookkeeping/settings` takes it. Each property is
 * unchanged when absent. The change is applied as a whole: the conformances of each legal form of the resulting history
 * check the resulting settings, and a change that is refused changes nothing.
 */
export type BookkeepingSettingsChangeModel = {
    /**
     * The currency the books are kept in, which changes only while there is no fiscal year. Unchanged when absent.
     */
    currency?: string | null,
    /**
     * A legal form appended to the history, valid from a day after the latest one and after the end of the last closed
     * fiscal year. Nothing is appended when absent.
     */
    legalForm?: BookkeepingLegalFormModel | null,
    /**
     * The company replacing the one of the settings whole, or null to remove it: what the company before held and this
     * one leaves out is gone. Unchanged when absent.
     */
    company?: BookkeepingCompanyModel | null
};
