import { MetadataUtilities } from '../../utilities';
import { HasRoleMetadata } from '../models';
import { AuthStrategies } from '../strategies';

/**
 * The type of the has role decorator.
 */
export interface HasRoleFn {
    (allowedRoles: string[], allowedStrategies?: AuthStrategies): MethodDecorator & ClassDecorator,
    /**
     * This skips the has role validation.
     */
    skip: () => MethodDecorator & ClassDecorator
}

/**
 * Marks an endpoint to be only reachable when the logged in user has one of the provided roles.
 * @param allowedRoles - All roles that are allowed to access this endpoint.
 * @param allowedStrategies - The auth strategies that are allowed to be used to check that.
 */
export const hasRoleDecorator: HasRoleFn = (
    (allowedRoles: string[], allowedStrategies?: AuthStrategies): MethodDecorator | ClassDecorator => {
        const fullMetadata: HasRoleMetadata = { allowedStrategies, allowedRoles };

        const decorator: MethodDecorator & ClassDecorator = (
            target: Object,
            propertyKey?: string | symbol
        ) => {
            if (propertyKey !== undefined) {
                MetadataUtilities.setRouteHasRole(target.constructor, fullMetadata, propertyKey as string);
            }
            else {
                MetadataUtilities.setControllerHasRole(target as Function, fullMetadata);
            }
        };
        return decorator;
    }
) as HasRoleFn;
hasRoleDecorator.skip = () => ((
    target: Object,
    propertyKey?: string | symbol
) => {
    if (propertyKey !== undefined) {
        MetadataUtilities.setRouteSkipHasRole(target.constructor, {}, propertyKey as string);
    }
    else {
        MetadataUtilities.setControllerSkipHasRole(target as Function, {});
    }
}) as MethodDecorator & ClassDecorator;