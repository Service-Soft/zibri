import { DefinedPermissions, definePermissions, DefinedPlatformPermissions, definePlatformPermissions } from './define-permissions.function';

/**
 * The tenant permissions the projects plugin of Zibri checks, in the tenant a request acts in: reading every project
 * of that tenant, writing projects and their boards, and archiving, deleting and sharing them. A member without
 * `projects.read` sees only the projects shared with them. Spread them into the tenant permissions of the
 * application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_PROJECTS_PERMISSIONS = ['projects.read', 'projects.write', 'projects.manage'] as const;

/**
 * The platform permissions the projects plugin of Zibri checks: the same as {@link ZIBRI_PROJECTS_PERMISSIONS} for the
 * projects of every tenant, in a request naming the tenant. Spread them into the platform permissions of the
 * application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_PROJECTS_PLATFORM_PERMISSIONS = ['projects.read_all', 'projects.write_all', 'projects.manage_all'] as const;

/**
 * {@link ZIBRI_PROJECTS_PERMISSIONS}, by name.
 */
export const ZibriProjectsPermissions: DefinedPermissions<typeof ZIBRI_PROJECTS_PERMISSIONS>
    = definePermissions(ZIBRI_PROJECTS_PERMISSIONS);

/**
 * {@link ZIBRI_PROJECTS_PLATFORM_PERMISSIONS}, by name.
 */
export const ZibriProjectsPlatformPermissions: DefinedPlatformPermissions<typeof ZIBRI_PROJECTS_PLATFORM_PERMISSIONS>
    = definePlatformPermissions(ZIBRI_PROJECTS_PLATFORM_PERMISSIONS);
