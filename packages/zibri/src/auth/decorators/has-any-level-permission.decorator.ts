import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { AnyLevelPermissions } from '../models/any-level-permissions.model';
import { HasAnyLevelPermissionMetadata } from '../models/has-any-level-permission-metadata.model';
import { AuthStrategies } from '../strategies/auth-strategies.model';

/**
 * The type of the has any level permission decorator, which names a tenant and a platform permission, either of
 * which is enough.
 */
export interface HasAnyLevelPermissionFn {
    (permissions: AnyLevelPermissions, allowedStrategies?: AuthStrategies): MethodDecorator & ClassDecorator,
    /**
     * This skips the permission validation.
     */
    skip: () => MethodDecorator & ClassDecorator
}

/**
 * Marks an endpoint to be only reachable when one of the roles the logged in user holds in the tenant the request
 * is for carries the tenant permission, or one of the roles of the user's own carries the platform permission.
 * @param permissions - The tenant and the platform permission, either of which opens this endpoint.
 * @param allowedStrategies - The auth strategies that are allowed to be used to check that.
 */
export const hasAnyLevelPermissionDecorator: HasAnyLevelPermissionFn = (
    (permissions: AnyLevelPermissions, allowedStrategies?: AuthStrategies): MethodDecorator | ClassDecorator => {
        const fullMetadata: HasAnyLevelPermissionMetadata = {
            permission: permissions.permission,
            platformPermission: permissions.platformPermission,
            allowedStrategies
        };

        const decorator: MethodDecorator & ClassDecorator = (
            target: Object,
            propertyKey?: string | symbol
        ) => {
            if (propertyKey !== undefined) {
                MetadataUtilities.setRouteHasAnyLevelPermission(target.constructor, fullMetadata, propertyKey as string);
            }
            else {
                MetadataUtilities.setControllerHasAnyLevelPermission(target as Function, fullMetadata);
            }
        };
        return decorator;
    }
) as HasAnyLevelPermissionFn;
hasAnyLevelPermissionDecorator.skip = () => (
    target: Object,
    propertyKey?: string | symbol
) => {
    if (propertyKey !== undefined) {
        MetadataUtilities.setRouteSkipHasAnyLevelPermission(target.constructor, {}, propertyKey as string);
    }
    else {
        MetadataUtilities.setControllerSkipHasAnyLevelPermission(target as Function, {});
    }
};