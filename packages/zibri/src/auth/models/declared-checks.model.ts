import { SkipMetadata } from './skip-auth-metadata.model';

/**
 * What a route and its controller declare about one kind of check: a login, no login, a permission or
 * a second factor.
 */
export type DeclaredChecks<Check extends object> = {
    /**
     * The check on the controller, if any.
     */
    controller: Check | undefined,
    /**
     * The check on the route, if any.
     */
    route: Check | undefined,
    /**
     * The skip of the check on the controller, if any.
     */
    controllerSkip: SkipMetadata | undefined,
    /**
     * The skip of the check on the route, if any.
     */
    routeSkip: SkipMetadata | undefined
};