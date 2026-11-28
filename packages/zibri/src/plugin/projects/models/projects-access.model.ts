import { type AnyLevelPermissions } from '../../../auth/models/any-level-permissions.model';
import { ZibriProjectsPermissions, ZibriProjectsPlatformPermissions } from './zibri-projects-permissions.model';

/**
 * The permissions of the projects plugin, each the tenant permission beside its platform variant, as
 * `@Auth.hasAnyLevelPermission` takes them: reading every project of a tenant, which is the `fullAccess` of
 * `Project`, writing them, and archiving, deleting and sharing them.
 */
export abstract class ProjectsAccess {
    /**
     * Reads every project of the tenant, `projects.read` or `projects.read_all`.
     */
    static readonly READ: AnyLevelPermissions = {
        permission: ZibriProjectsPermissions.PROJECTS_READ,
        platformPermission: ZibriProjectsPlatformPermissions.PROJECTS_READ_ALL
    };
    /**
     * Creates and changes projects, and writes their boards, `projects.write` or `projects.write_all`.
     */
    static readonly WRITE: AnyLevelPermissions = {
        permission: ZibriProjectsPermissions.PROJECTS_WRITE,
        platformPermission: ZibriProjectsPlatformPermissions.PROJECTS_WRITE_ALL
    };
    /**
     * Archives, deletes and shares projects, `projects.manage` or `projects.manage_all`.
     */
    static readonly MANAGE: AnyLevelPermissions = {
        permission: ZibriProjectsPermissions.PROJECTS_MANAGE,
        platformPermission: ZibriProjectsPlatformPermissions.PROJECTS_MANAGE_ALL
    };
}
