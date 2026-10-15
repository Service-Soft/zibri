import { HasRoleFn } from './has-role.decorator';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { HasRoleMetadata } from '../models/has-role-metadata.model';
import { AuthStrategies } from '../strategies/auth-strategies.model';

/**
 * Marks an endpoint to be only reachable when the logged in user holds one of the provided roles of
 * their own, whichever tenant the request is for.
 * @param allowedRoles - All roles that are allowed to access this endpoint.
 * @param allowedStrategies - The auth strategies that are allowed to be used to check that.
 */
export const hasPlatformRoleDecorator: HasRoleFn = (
    (allowedRoles: string[], allowedStrategies?: AuthStrategies): MethodDecorator | ClassDecorator => {
        const fullMetadata: HasRoleMetadata = { allowedStrategies, allowedRoles };

        const decorator: MethodDecorator & ClassDecorator = (
            target: Object,
            propertyKey?: string | symbol
        ) => {
            if (propertyKey !== undefined) {
                MetadataUtilities.setRouteHasPlatformRole(target.constructor, fullMetadata, propertyKey as string);
            }
            else {
                MetadataUtilities.setControllerHasPlatformRole(target as Function, fullMetadata);
            }
        };
        return decorator;
    }
) as HasRoleFn;
hasPlatformRoleDecorator.skip = () => ((
    target: Object,
    propertyKey?: string | symbol
) => {
    if (propertyKey !== undefined) {
        MetadataUtilities.setRouteSkipHasPlatformRole(target.constructor, {}, propertyKey as string);
    }
    else {
        MetadataUtilities.setControllerSkipHasPlatformRole(target as Function, {});
    }
}) as MethodDecorator & ClassDecorator;