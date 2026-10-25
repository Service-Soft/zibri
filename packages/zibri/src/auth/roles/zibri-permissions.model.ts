import { definePermissions, DefinedPermissions, DefinedPlatformPermissions, definePlatformPermissions } from './define-permissions.function';

/**
 * The tenant permissions Zibri checks itself, in the tenant a request acts in: handing out tenant
 * roles and taking them away, and defining the roles of that tenant's own.
 *
 * A `role` is any tenant role, a `tenant_role` a role of the tenant's own. `with_own_permissions`
 * allows a role whose every permission the caller holds in the tenant, `with_any_permission` any
 * role. Spread them into the tenant permissions of the application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_PERMISSIONS = [
    'auth.assign_role.with_own_permissions',
    'auth.assign_role.with_any_permission',
    'auth.unassign_role.with_own_permissions',
    'auth.unassign_role.with_any_permission',
    'auth.create_tenant_role.with_own_permissions',
    'auth.create_tenant_role.with_any_permission',
    'auth.update_tenant_role.with_own_permissions',
    'auth.update_tenant_role.with_any_permission',
    'auth.delete_tenant_role.with_own_permissions',
    'auth.delete_tenant_role.with_any_permission'
] as const;

/**
 * The platform permissions Zibri checks itself: defining roles of either level, and handing out
 * platform roles and taking them away.
 *
 * A `role` is a tenant role every tenant shares and a `platform_role` a platform role. `with_own_permissions` allows a
 * role whose every permission the caller holds at that level, `with_any_permission` any role. Spread
 * them into the platform permissions of the application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_PLATFORM_PERMISSIONS = [
    'auth.create_role.with_own_permissions',
    'auth.create_role.with_any_permission',
    'auth.create_platform_role.with_own_permissions',
    'auth.create_platform_role.with_any_permission',
    'auth.update_role.with_own_permissions',
    'auth.update_role.with_any_permission',
    'auth.update_platform_role.with_own_permissions',
    'auth.update_platform_role.with_any_permission',
    'auth.delete_role.with_own_permissions',
    'auth.delete_role.with_any_permission',
    'auth.delete_platform_role.with_own_permissions',
    'auth.delete_platform_role.with_any_permission',
    'auth.assign_platform_role.with_own_permissions',
    'auth.assign_platform_role.with_any_permission',
    'auth.unassign_platform_role.with_own_permissions',
    'auth.unassign_platform_role.with_any_permission'
] as const;

/**
 * {@link ZIBRI_PERMISSIONS}, by name.
 */
export const ZibriPermissions: DefinedPermissions<typeof ZIBRI_PERMISSIONS> = definePermissions(ZIBRI_PERMISSIONS);

/**
 * {@link ZIBRI_PLATFORM_PERMISSIONS}, by name.
 */
export const ZibriPlatformPermissions: DefinedPlatformPermissions<typeof ZIBRI_PLATFORM_PERMISSIONS>
    = definePlatformPermissions(ZIBRI_PLATFORM_PERMISSIONS);