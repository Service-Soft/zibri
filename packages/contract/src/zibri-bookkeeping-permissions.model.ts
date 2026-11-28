import { DefinedPermissions, definePermissions, DefinedPlatformPermissions, definePlatformPermissions } from './define-permissions.function';

/**
 * The tenant permissions the bookkeeping plugin of Zibri checks, in the tenant a request acts in: reading the books of
 * that tenant and checking them, posting and reversing entries, closing fiscal years and reopening them to correct
 * their books, setting up the books with their
 * settings, accounts, fiscal years and rules, entering, recording and correcting expenses, and exporting a fiscal year
 * for a tax audit. Spread them into the tenant permissions of the application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_BOOKKEEPING_PERMISSIONS = [
    'bookkeeping.read',
    'bookkeeping.post',
    'bookkeeping.close-fiscal-year',
    'bookkeeping.reopen-fiscal-year',
    'bookkeeping.manage',
    'bookkeeping.expenses.manage',
    'bookkeeping.export'
] as const;

/**
 * The platform permissions the bookkeeping plugin of Zibri checks: the same as {@link ZIBRI_BOOKKEEPING_PERMISSIONS}
 * for the books of every tenant, in a request naming no tenant. Spread them into the platform permissions of the
 * application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_BOOKKEEPING_PLATFORM_PERMISSIONS = [
    'bookkeeping.read_all',
    'bookkeeping.post_all',
    'bookkeeping.close-fiscal-year_all',
    'bookkeeping.reopen-fiscal-year_all',
    'bookkeeping.manage_all',
    'bookkeeping.expenses.manage_all',
    'bookkeeping.export_all'
] as const;

/**
 * {@link ZIBRI_BOOKKEEPING_PERMISSIONS}, by name.
 */
export const ZibriBookkeepingPermissions: DefinedPermissions<typeof ZIBRI_BOOKKEEPING_PERMISSIONS>
    = definePermissions(ZIBRI_BOOKKEEPING_PERMISSIONS);

/**
 * {@link ZIBRI_BOOKKEEPING_PLATFORM_PERMISSIONS}, by name.
 */
export const ZibriBookkeepingPlatformPermissions: DefinedPlatformPermissions<typeof ZIBRI_BOOKKEEPING_PLATFORM_PERMISSIONS>
    = definePlatformPermissions(ZIBRI_BOOKKEEPING_PLATFORM_PERMISSIONS);
