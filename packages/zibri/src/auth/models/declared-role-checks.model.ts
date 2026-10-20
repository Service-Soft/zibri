import { HasRoleMetadata, SkipHasRoleMetadata } from './has-role-metadata.model.ts';

/**
 * What a route and its controller declare about one kind of role check.
 */
export type DeclaredRoleChecks = {
    /**
     * The check on the controller, if any.
     */
    controller: HasRoleMetadata | undefined,
    /**
     * The check on the route, if any.
     */
    route: HasRoleMetadata | undefined,
    /**
     * The skip of the check on the controller, if any.
     */
    controllerSkip: SkipHasRoleMetadata | undefined,
    /**
     * The skip of the check on the route, if any.
     */
    routeSkip: SkipHasRoleMetadata | undefined
};