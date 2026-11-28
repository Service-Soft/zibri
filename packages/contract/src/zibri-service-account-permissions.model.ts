import { DefinedPlatformPermissions, definePlatformPermissions } from './define-permissions.function';

/**
 * The platform permissions the routes of the service accounts of Zibri check: listing the service accounts with their
 * roles, their API keys and the MCP tools they can use, and creating them, changing their roles, creating and revoking
 * their API keys and deleting them. Spread them into the platform permissions of the application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_SERVICE_ACCOUNT_PLATFORM_PERMISSIONS = ['service-accounts.read', 'service-accounts.manage'] as const;

/**
 * {@link ZIBRI_SERVICE_ACCOUNT_PLATFORM_PERMISSIONS}, by name.
 */
export const ZibriServiceAccountPlatformPermissions: DefinedPlatformPermissions<typeof ZIBRI_SERVICE_ACCOUNT_PLATFORM_PERMISSIONS>
    = definePlatformPermissions(ZIBRI_SERVICE_ACCOUNT_PLATFORM_PERMISSIONS);