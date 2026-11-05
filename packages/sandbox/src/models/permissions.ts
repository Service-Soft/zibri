import { DefinedPermissions, definePermissions, DefinedPlatformPermissions, definePlatformPermissions, PermissionDeclaration, ZIBRI_PERMISSIONS, ZIBRI_PLATFORM_PERMISSIONS } from 'zibri';

// every permission of the application: what routes may ask for, and what roles may carry. A tenant
// permission is held through a membership, a platform permission by the user. See the permissions docs.
// eslint-disable-next-line typescript/typedef
const PERMISSIONS = [...ZIBRI_PERMISSIONS] as const;
// eslint-disable-next-line typescript/typedef
const PLATFORM_PERMISSIONS = [...ZIBRI_PLATFORM_PERMISSIONS] as const;

export const Permissions: DefinedPermissions<typeof PERMISSIONS> = definePermissions(PERMISSIONS);
export const PlatformPermissions: DefinedPlatformPermissions<typeof PLATFORM_PERMISSIONS> = definePlatformPermissions(PLATFORM_PERMISSIONS);

export const permissions: PermissionDeclaration = {
    permissions: Object.values(Permissions),
    platformPermissions: Object.values(PlatformPermissions)
};