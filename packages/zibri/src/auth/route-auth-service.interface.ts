import { HasPermissionMetadata } from './models/has-permission-metadata.model';
import { IsLoggedInMetadata } from './models/is-logged-in-metadata.model';
import { IsNotLoggedInMetadata } from './models/is-not-logged-in-metadata.model';
import { Require2faMetadata } from './models/require-2fa-metadata.model';
import { ResolvedRouteAuth } from './models/resolved-auth-metadata.model';
import { RouteAuthConfiguration } from './models/route-auth-configuration.model';
import { type Permission } from './roles/permission.type';
import { type PlatformPermission } from './roles/platform-permission.type';
import { RoleLevel } from './roles/role-level.type';
import { Newable } from '../types/newable.type';

/**
 * Interface for the service resolving what routes declare about who may reach them.
 */
export interface RouteAuthServiceInterface {
    /**
     * Resolves everything the \@Auth decorators of the provided controller method and its controller
     * mean for a caller, the application wide default included.
     *
     * Called while the route is registered - resolving a declaration is where an impossible one is
     * refused and where the "Useless @Auth.skip" warnings come from, and both belong to booting.
     * Whoever serves a request reads the answer back out of the route registry instead.
     */
    resolveRouteAuth: (controllerClass: Newable<unknown>, controllerMethod: string) => ResolvedRouteAuth,
    /**
     * Resolves what a manually registered route states about who may reach it, the application wide
     * default included. A route that states nothing is the same as a controller route carrying no
     * decorators: the application's `defaultAuth` decides.
     */
    resolveManualRouteAuth: (auth: RouteAuthConfiguration | undefined) => ResolvedRouteAuth,
    /**
     * Checks whether reaching the provided method on the provided controller requires an
     * authenticated caller - including when it requires one only because the application declared
     * `defaultAuth: 'isLoggedIn'` and the route says nothing itself.
     */
    requiresAuthentication: (controllerClass: Newable<unknown>, controllerMethod: string) => boolean | Promise<boolean>,
    /**
     * Checks whether reaching a manually registered route requires an authenticated caller -
     * including when it requires one only because the application declared
     * `defaultAuth: 'isLoggedIn'` and the route states nothing itself.
     */
    requiresRouteAuthentication: (auth: RouteAuthConfiguration | undefined) => boolean,
    /**
     * Refuses what a manually registered route states about who may reach it when it names a
     * permission that is not declared. Called while the route is registered.
     * @throws An InternalError naming the route and what it names.
     */
    validateRouteAuth: (auth: RouteAuthConfiguration | undefined, route: string) => void,
    /**
     * Refuses a permission that is not declared at a level in `ZIBRI_DI_TOKENS.PERMISSIONS`, for
     * anything naming one outside a route. Called while the application starts.
     * @param level - The level the permission is checked at.
     * @param permission - The permission.
     * @param usedBy - What names it, for the error.
     * @throws An InternalError naming both.
     */
    validatePermissionIsDeclared: (level: RoleLevel, permission: string, usedBy: string) => void,
    /**
     * Resolves the is logged in metadata for the provided controller method.
     * (Whether it's required to be logged in, etc.).
     */
    resolveIsLoggedInMetadata: (controllerClass: Newable<unknown>, controllerMethod: string) => IsLoggedInMetadata | undefined,
    /**
     * Resolves the is not logged in metadata for the provided controller method.
     * (Whether it's required to be logged out, etc.).
     */
    resolveIsNotLoggedInMetadata: (controllerClass: Newable<unknown>, controllerMethod: string) => IsNotLoggedInMetadata | undefined,
    /**
     * Resolves the has permission metadata for the provided controller method.
     * @throws When the permission it names is not declared.
     */
    resolveHasPermissionMetadata: (
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ) => HasPermissionMetadata<Permission> | undefined,
    /**
     * Resolves the has platform permission metadata for the provided controller method.
     * @throws When the permission it names is not declared.
     */
    resolveHasPlatformPermissionMetadata: (
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ) => HasPermissionMetadata<PlatformPermission> | undefined,
    /**
     * Resolves the require 2fa metadata for the provided controller method.
     */
    resolveRequire2faMetadata: (controllerClass: Newable<unknown>, controllerMethod: string) => Require2faMetadata | undefined
}