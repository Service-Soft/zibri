import { type Permission } from '../roles/permission.type';
import { type PlatformPermission } from '../roles/platform-permission.type';

/**
 * A tenant permission and a platform permission, either of which is enough.
 */
export type AnyLevelPermissions = {
    /**
     * The tenant permission, carried by a role of the user's membership in the tenant the request is for.
     */
    permission: Permission,
    /**
     * The platform permission, carried by one of the user's own roles.
     */
    platformPermission: PlatformPermission
};