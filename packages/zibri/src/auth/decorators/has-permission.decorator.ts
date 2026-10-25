import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { HasPermissionMetadata } from '../models/has-permission-metadata.model';
import { type Permission } from '../roles/permission.type';
import { type PlatformPermission } from '../roles/platform-permission.type';
import { AuthStrategies } from '../strategies/auth-strategies.model';

/**
 * The type of the has permission and has platform permission decorators, which name a tenant and a
 * platform permission.
 */
export interface HasPermissionFn<PermissionType extends Permission | PlatformPermission> {
    (permission: PermissionType, allowedStrategies?: AuthStrategies): MethodDecorator & ClassDecorator,
    /**
     * This skips the permission validation.
     */
    skip: () => MethodDecorator & ClassDecorator
}

/**
 * Marks an endpoint to be only reachable when one of the roles the logged in user holds in the
 * tenant the request is for carries the provided permission.
 * @param permission - The permission needed to access this endpoint.
 * @param allowedStrategies - The auth strategies that are allowed to be used to check that.
 */
export const hasPermissionDecorator: HasPermissionFn<Permission> = (
    (permission: Permission, allowedStrategies?: AuthStrategies): MethodDecorator | ClassDecorator => {
        const fullMetadata: HasPermissionMetadata<Permission> = { allowedStrategies, permission };

        const decorator: MethodDecorator & ClassDecorator = (
            target: Object,
            propertyKey?: string | symbol
        ) => {
            if (propertyKey !== undefined) {
                MetadataUtilities.setRouteHasPermission(target.constructor, fullMetadata, propertyKey as string);
            }
            else {
                MetadataUtilities.setControllerHasPermission(target as Function, fullMetadata);
            }
        };
        return decorator;
    }
) as HasPermissionFn<Permission>;
hasPermissionDecorator.skip = () => ((
    target: Object,
    propertyKey?: string | symbol
) => {
    if (propertyKey !== undefined) {
        MetadataUtilities.setRouteSkipHasPermission(target.constructor, {}, propertyKey as string);
    }
    else {
        MetadataUtilities.setControllerSkipHasPermission(target as Function, {});
    }
}) as MethodDecorator & ClassDecorator;