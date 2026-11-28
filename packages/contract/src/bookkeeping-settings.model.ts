import { type BookkeepingCompanyModel } from './bookkeeping-company.model';
import { type BookkeepingLegalFormModel } from './bookkeeping-legal-form.model';

/**
 * The settings of the books of a tenant, as `GET /bookkeeping/settings` answers it. A tenant keeps books once it has
 * them.
 */
export type BookkeepingSettingsModel = {
    /**
     * The id of the settings.
     */
    id: string,
    /**
     * The tenant keeping the books.
     */
    tenantId: string,
    /**
     * The currency the books are kept in, such as `EUR`.
     */
    currency: string,
    /**
     * The history of the legal form of the tenant, the earliest first.
     */
    legalForms: BookkeepingLegalFormModel[],
    /**
     * The company whose books they are, which its statements name, or null for none.
     */
    company?: BookkeepingCompanyModel | null
};
