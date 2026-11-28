import { type BookkeepingCompanyModel } from './bookkeeping-company.model';
import { type BookkeepingLegalFormModel } from './bookkeeping-legal-form.model';

/**
 * The settings to start the books of a tenant with, as `POST /bookkeeping/settings` takes them.
 */
export type NewBookkeepingSettingsModel = {
    /**
     * The currency the books are kept in, such as `EUR`.
     */
    currency: string,
    /**
     * The history of the legal form of the tenant, the earliest first.
     */
    legalForms: BookkeepingLegalFormModel[],
    /**
     * The company whose books they are, or null for none. A corporation under the HGB names its name, seat, register
     * court and register number.
     */
    company?: BookkeepingCompanyModel | null
};