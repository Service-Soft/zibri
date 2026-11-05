import { type Permission } from './permission.type';
import { type PlatformPermission } from './platform-permission.type';

/**
 * Every permission of an application, as `ZIBRI_DI_TOKENS.PERMISSIONS` takes them. Roles are rows,
 * which carry these.
 */
export type PermissionDeclaration = {
    /**
     * Every permission a tenant role can carry and `@Auth.hasPermission` can name.
     */
    permissions: readonly Permission[],
    /**
     * Every permission a platform role can carry and `@Auth.hasPlatformPermission` can name.
     */
    platformPermissions: readonly PlatformPermission[]
};