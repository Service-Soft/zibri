import { HasRoleMetadata } from './has-role-metadata.model.ts';
import { IsLoggedInMetadata } from './is-logged-in-metadata.model.ts';
import { IsNotLoggedInMetadata } from './is-not-logged-in-metadata.model.ts';
import { Require2faMetadata } from './require-2fa-metadata.model.ts';

/**
 * What the \@Auth decorators of a route and its controller resolve to, with the skips already applied.
 *
 * Resolving them costs nothing but is not free of side effects - the resolvers are where the
 * "Useless @Auth.x.skip" warnings come from - so whoever asks for them passes them on rather than
 * having every consumer resolve its own set.
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
     * The resolved \@Auth.hasRole metadata, if the route requires a role in the request's tenant.
     */
    hasRole: HasRoleMetadata | undefined,
    /**
     * The resolved \@Auth.hasPlatformRole metadata, if the route requires a role of the user's own.
     */
    hasPlatformRole: HasRoleMetadata | undefined,
    /**
     * The resolved \@Auth.require2fa metadata, if the route requires a second factor.
     */
    require2fa: Require2faMetadata | undefined
};

/**
 * What one route's declaration means for a caller, with the application wide default already applied.
 *
 * The two halves are resolved together because the second one is not readable off the first: a route
 * that declares nothing still requires a login under a `'requireLogin'` default.
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