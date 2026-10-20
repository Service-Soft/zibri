import { hasPlatformRoleDecorator } from './has-platform-role.decorator.ts';
import { hasRoleDecorator, HasRoleFn } from './has-role.decorator.ts';
import { isLoggedInDecorator, IsLoggedInFn } from './is-logged-in.decorator.ts';
import { isNotLoggedInDecorator, IsNotLoggedInFn } from './is-not-logged-in.decorator.ts';
import { require2faDecorator, Require2faFn } from './require-2fa.decorator.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { SkipAuthMetadata } from '../models/skip-auth-metadata.model.ts';

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
     * Marks an endpoint to be only reachable when the logged in user holds one of the provided roles
     * in the tenant the request is for, through their membership in it.
     * @param allowedRoles - All roles that are allowed to access this endpoint.
     * @param allowedStrategies - The auth strategies that are allowed to be used to check that.
     */
    export const hasRole: HasRoleFn = hasRoleDecorator;
    /**
     * Marks an endpoint to be only reachable when the logged in user holds one of the provided roles
     * of their own, whichever tenant the request is for - eg. An operator of the whole application.
     * @param allowedRoles - All roles that are allowed to access this endpoint.
     * @param allowedStrategies - The auth strategies that are allowed to be used to check that.
     */
    export const hasPlatformRole: HasRoleFn = hasPlatformRoleDecorator;
    /**
     * Marks an endpoint to be only reachable when the logged in user provides a second factor somehow.
     * @param allowedMethods - The allowed two factor methods to use.
     */
    export const require2fa: Require2faFn = require2faDecorator;

    /**
     * Skips all auth related validation, on a single route or on a whole controller.
     *
     * This is also how a route opts out of an application wide `defaultAuth` of `'requireLogin'`,
     * which is what makes it the one place a public endpoint is declared rather than merely left
     * undecorated.
     * @param options - Additional options for the skip.
     * @returns The decorator, usable on a route or on a controller.
     */
    export function skip(options: Partial<SkipAuthMetadata> = {}): MethodDecorator & ClassDecorator {
        const fullMetadata: SkipAuthMetadata = { allowRedundant: false, ...options };

        return ((target: object, propertyKey?: string | symbol) => {
            if (propertyKey !== undefined) {
                MetadataUtilities.setRouteSkipAuth(target.constructor, fullMetadata, propertyKey as string);
            }
            else {
                MetadataUtilities.setControllerSkipAuth(target as Function, fullMetadata);
            }
        });
    }
}