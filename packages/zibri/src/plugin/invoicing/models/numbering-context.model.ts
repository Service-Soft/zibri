import { ZonedDate } from '../../../localization/format-date.function';
import { CompanyInfo } from './company-info.model';

/**
 * The company issuing an invoice, and the moment it is numbered at in its time zone, which
 * `resolveNumberingContext` of the `InvoiceNumberService` answers.
 */
export type NumberingContext = {
    /**
     * The id of the tenant.
     */
    tenantId: string,
    /**
     * The company of the tenant.
     */
    company: CompanyInfo,
    /**
     * Now, in the time zone of the company.
     */
    date: ZonedDate
};
