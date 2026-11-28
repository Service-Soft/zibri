import { DefinedPermissions, definePermissions, DefinedPlatformPermissions, definePlatformPermissions } from './define-permissions.function';

/**
 * The tenant permissions the routes of the invoicing plugin of Zibri check, in the tenant a request acts in: reading the
 * invoices and credit notes of that tenant, and their documents. Spread them into the tenant permissions of the
 * application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_INVOICING_PERMISSIONS = ['invoicing.invoices.read'] as const;

/**
 * The platform permissions the routes of the invoicing plugin of Zibri check: the same as
 * {@link ZIBRI_INVOICING_PERMISSIONS} for the invoices of every tenant, in a request naming no tenant. Spread them into
 * the platform permissions of the application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_INVOICING_PLATFORM_PERMISSIONS = ['invoicing.invoices.read_all'] as const;

/**
 * {@link ZIBRI_INVOICING_PERMISSIONS}, by name.
 */
export const ZibriInvoicingPermissions: DefinedPermissions<typeof ZIBRI_INVOICING_PERMISSIONS>
    = definePermissions(ZIBRI_INVOICING_PERMISSIONS);

/**
 * {@link ZIBRI_INVOICING_PLATFORM_PERMISSIONS}, by name.
 */
export const ZibriInvoicingPlatformPermissions: DefinedPlatformPermissions<typeof ZIBRI_INVOICING_PLATFORM_PERMISSIONS>
    = definePlatformPermissions(ZIBRI_INVOICING_PLATFORM_PERMISSIONS);