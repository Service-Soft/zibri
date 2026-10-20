import { CompanyInfo } from '../models/company-info.model.ts';

/**
 * Interface for the service that says which company issues the invoices of a tenant.
 */
export interface CompanyInfoServiceInterface {
    /**
     * Resolves the company that issues the invoices of a tenant: what its invoices show, and whom
     * their electronic form names as the seller.
     */
    resolveCompanyInfo: (tenantId: string) => Promise<CompanyInfo>
}