import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type BaseTenantDefinition } from '../../../tenancy/tenant-definition/base-tenant-definition.model';
import { type NewBookkeepingSettings } from './new-bookkeeping-settings.model';

/**
 * What the bookkeeping plugin does when a tenant without bookkeeping settings issues an invoice, records an expense or
 * confirms a bank match: `post-nothing` lets it happen without a posting, `refuse` refuses it until the settings are
 * created. `never` gives every tenant its settings as it is created, and refuses to start the application while a
 * tenant that is not deactivated has none.
 */
export type TenantsWithoutBooks = TenantsWithoutBooksOptions['tenantsWithoutBooks'];

/**
 * Resolves the bookkeeping settings a tenant is created with, in the transaction it is created in.
 */
export type ResolveTenantBookkeepingSettings = (tenant: BaseTenantDefinition, transaction: Transaction) => Promise<NewBookkeepingSettings>;

/**
 * What a tenant without bookkeeping settings does, and with `never` what a tenant is created with.
 */
export type TenantsWithoutBooksOptions = {
    /**
     * What happens when a tenant without bookkeeping settings, which keeps no books, issues an invoice, records an
     * expense or confirms a bank match: `post-nothing` posts nothing, and `refuse` refuses it until the settings are
     * created.
     */
    readonly tenantsWithoutBooks: 'post-nothing' | 'refuse',
    /**
     * Taken with `never` only.
     */
    readonly resolveSettingsOf?: undefined
} | {
    /**
     * `never`: every tenant of the entity of the tenants gets its settings as it is created, and the application does
     * not start while a tenant that is not deactivated has none.
     */
    readonly tenantsWithoutBooks: 'never',
    /**
     * Resolves the settings each tenant is created with. What it throws refuses the tenant.
     */
    readonly resolveSettingsOf: ResolveTenantBookkeepingSettings
};
