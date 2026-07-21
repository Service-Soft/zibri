import { belongsToDecorator, BelongsToFn } from './belongs-to.decorator';
import { hasRoleDecorator, HasRoleFn } from './has-role.decorator';
import { isLoggedInDecorator, IsLoggedInFn } from './is-logged-in.decorator';
import { isNotLoggedInDecorator, IsNotLoggedInFn } from './is-not-logged-in.decorator';
import { require2faDecorator, Require2faFn } from './require-2fa.decorator';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * Bundles decorators for marking controller endpoints for authentication and authorization.
 */
// eslint-disable-next-line typescript/no-namespace
export namespace Auth {
    /**
     * Marks an endpoint to be only reachable when there is a logged in user.
     * @param allowedStrategies - The auth strategies that are allowed to be used to check that.
     */
    export const isLoggedIn: IsLoggedInFn = isLoggedInDecorator;
    /**
     * Marks an endpoint to be only reachable when there is no logged in user.
     * @param allowedStrategies - The auth strategies that are allowed to be used to check that.
     */
    export const isNotLoggedIn: IsNotLoggedInFn = isNotLoggedInDecorator;
    /**
     * Marks an endpoint to be only reachable when the logged in user has one of the provided roles.
     * @param allowedRoles - All roles that are allowed to access this endpoint.
     * @param allowedStrategies - The auth strategies that are allowed to be used to check that.
     */
    export const hasRole: HasRoleFn = hasRoleDecorator;
    /**
     * Marks an endpoint to be only reachable when the logged in user belongs to the requested resource somehow.
     * @param targetEntity - The target entity that needs to be checked to belong to the user.
     * @param targetIdParamKey - The key of the id path parameter in the endpoint.
     * @param targetUserIdKey - The key on the target, that defines to which user it belongs.
     * @param allowedStrategies - The auth strategies that are allowed to be used to check that.
     */
    export const belongsTo: BelongsToFn = belongsToDecorator;
    /**
     * Marks an endpoint to be only reachable when the logged in user provides a second factor somehow.
     * @param allowedMethods - The allowed two factor methods to use.
     */
    export const require2fa: Require2faFn = require2faDecorator;

    /**
     * Skips all auth related validation.
     */
    export function skip(): MethodDecorator {
        return (target, propertyKey) => {
            MetadataUtilities.setRouteSkipAuth(target.constructor, {}, propertyKey as string);
        };
    }
}