import { defineProvider, DiProvider } from '../../di/models/di-provider.model.ts';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../../plugin/invoicing/invoicing.tokens.ts';
import { CompanyInfo } from '../../plugin/invoicing/models/company-info.model.ts';
import { CompanyInfoServiceInterface } from '../../plugin/invoicing/services/company-info-service.interface.ts';

/**
 * Provides the company each tenant issues its invoices as.
 * @param resolve - Answers the company of a tenant.
 * @returns The provider.
 */
export function companyInfoProvider(resolve: (tenantId: string) => CompanyInfo): DiProvider<CompanyInfoServiceInterface> {
    return defineProvider({
        token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE,
        useValue: { resolveCompanyInfo: async tenantId => await Promise.resolve(resolve(tenantId)) }
    });
}