import { HasPermissionMetadata } from './has-permission-metadata.model';
import { IsLoggedInMetadata } from './is-logged-in-metadata.model';
import { IsNotLoggedInMetadata } from './is-not-logged-in-metadata.model';
import { Require2faMetadata } from './require-2fa-metadata.model';
import { type Permission } from '../roles/permission.type';
import { type PlatformPermission } from '../roles/platform-permission.type';

// Resolving them costs nothing but is not free of side effects - the resolvers are where the
// "Useless @Auth.x.skip" warnings come from - so whoever asks for them passes them on rather than
// having every consumer resolve its own set.
/**
 * What the \@Auth decorators of a route and its controller resolve to, with the skips already applied.
 */
export type ResolvedAuthMetadata = {
    /**
     * The resolved \@Auth.isLoggedIn metadata, if the route requires a login of its own.
     */
    isLoggedIn: IsLoggedInMetadata | undefined,
    /**
     * The resolved \@Auth.isNotLoggedIn metadata, if the route refuses logged in callers.
     */
    isNotLoggedIn: IsNotLoggedInMetadata | undefined,
    /**
     * The resolved \@Auth.hasPermission metadata, if the route requires a permission in the request's tenant.
     */
    hasPermission: HasPermissionMetadata<Permission> | undefined,
    /**
     * The resolved \@Auth.hasPlatformPermission metadata, if the route requires a permission of the user's own.
     */
    hasPlatformPermission: HasPermissionMetadata<PlatformPermission> | undefined,
    /**
     * The resolved \@Auth.require2fa metadata, if the route requires a second factor.
     */
    require2fa: Require2faMetadata | undefined
};

/**
 * What one route's declaration means for a caller, with the application wide default already applied.
 *
 * The two halves are resolved together because the second one is not readable off the first: a route
 * that declares nothing still requires a login under a `'isLoggedIn'` default.
 */
export type ResolvedRouteAuth = {
    /**
     * The checks the route declared.
     */
    readonly metadata: ResolvedAuthMetadata,
    /**
     * Whether a caller has to be authenticated, the application wide default included.
     */
    readonly requiresLogin: boolean
};