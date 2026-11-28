import { DefinedPermissions, definePermissions, DefinedPlatformPermissions, definePlatformPermissions } from './define-permissions.function';

/**
 * The tenant permissions the E-Bilanz of the bookkeeping plugin of Zibri checks, in the tenant a request acts in:
 * reading the E-Bilanz of a fiscal year, preparing and exporting it and recording it as filed by hand, sending it, and
 * keeping the company data and the ELSTER certificate. Spread them into the tenant permissions of the application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_E_BILANZ_PERMISSIONS = [
    'bookkeeping.e-bilanz.read',
    'bookkeeping.e-bilanz.prepare',
    'bookkeeping.e-bilanz.transmit',
    'bookkeeping.e-bilanz.manage'
] as const;

/**
 * The platform permissions the E-Bilanz of the bookkeeping plugin of Zibri checks: the same as
 * {@link ZIBRI_E_BILANZ_PERMISSIONS} for the books of every tenant, in a request naming no tenant.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_E_BILANZ_PLATFORM_PERMISSIONS = [
    'bookkeeping.e-bilanz.read_all',
    'bookkeeping.e-bilanz.prepare_all',
    'bookkeeping.e-bilanz.transmit_all',
    'bookkeeping.e-bilanz.manage_all'
] as const;

/**
 * {@link ZIBRI_E_BILANZ_PERMISSIONS}, by name.
 */
export const ZibriEBilanzPermissions: DefinedPermissions<typeof ZIBRI_E_BILANZ_PERMISSIONS>
    = definePermissions(ZIBRI_E_BILANZ_PERMISSIONS);

/**
 * {@link ZIBRI_E_BILANZ_PLATFORM_PERMISSIONS}, by name.
 */
export const ZibriEBilanzPlatformPermissions: DefinedPlatformPermissions<typeof ZIBRI_E_BILANZ_PLATFORM_PERMISSIONS>
    = definePlatformPermissions(ZIBRI_E_BILANZ_PLATFORM_PERMISSIONS);
