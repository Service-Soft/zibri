import { HasPermissionFn } from './has-permission.decorator';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { HasPermissionMetadata } from '../models/has-permission-metadata.model';
import { type PlatformPermission } from '../roles/platform-permission.type';
import { AuthStrategies } from '../strategies/auth-strategies.model';

/**
 * Marks an endpoint to be only reachable when one of the roles of the logged in user's own carries
 * the provided permission, whichever tenant the request is for.
 * @param permission - The permission needed to access this endpoint.
 * @param allowedStrategies - The auth strategies that are allowed to be used to check that.
 */
export const hasPlatformPermissionDecorator: HasPermissionFn<PlatformPermission> = (
    (permission: PlatformPermission, allowedStrategies?: AuthStrategies): MethodDecorator | ClassDecorator => {
        const fullMetadata: HasPermissionMetadata<PlatformPermission> = { allowedStrategies, permission };

        const decorator: MethodDecorator & ClassDecorator = (
            target: Object,
            propertyKey?: string | symbol
        ) => {
            if (propertyKey !== undefined) {
                MetadataUtilities.setRouteHasPlatformPermission(target.constructor, fullMetadata, propertyKey as string);
            }
            else {
                MetadataUtilities.setControllerHasPlatformPermission(target as Function, fullMetadata);
            }
        };
        return decorator;
    }
) as HasPermissionFn<PlatformPermission>;
hasPlatformPermissionDecorator.skip = () => ((
    target: Object,
    propertyKey?: string | symbol
) => {
    if (propertyKey !== undefined) {
        MetadataUtilities.setRouteSkipHasPlatformPermission(target.constructor, {}, propertyKey as string);
    }
    else {
        MetadataUtilities.setControllerSkipHasPlatformPermission(target as Function, {});
    }
}) as MethodDecorator & ClassDecorator;