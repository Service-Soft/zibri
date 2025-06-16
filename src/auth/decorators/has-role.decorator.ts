import { MetadataUtilities } from '../../utilities';
import { AuthStrategies, HasRoleMetadata } from '../models';

export interface HasRoleFn {
    (allowedRoles: string[], allowedStrategies?: AuthStrategies): MethodDecorator & ClassDecorator,
    skip: () => MethodDecorator & ClassDecorator
}

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