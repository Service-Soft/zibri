import { MetadataUtilities } from '../../utilities';
import { IsLoggedInMetadata } from '../models';
import { AuthStrategies } from '../strategies';

/**
 * The type of the is logged in decorator.
 */
export interface IsLoggedInFn {
    (allowedStrategies?: AuthStrategies): MethodDecorator & ClassDecorator,
    /**
     * This skips the is logged in validation.
     */
    skip: () => MethodDecorator & ClassDecorator
}

/**
 * Marks an endpoint to be only reachable when there is a logged in user.
 * @param allowedStrategies - The auth strategies that are allowed to be used to check that.
 */
export const isLoggedInDecorator: IsLoggedInFn = ((allowedStrategies?: AuthStrategies) => {
    const fullMetadata: IsLoggedInMetadata = { allowedStrategies };

    const decorator: MethodDecorator & ClassDecorator = (
        target: Object,
        propertyKey?: string | symbol
    ) => {
        if (propertyKey !== undefined) {
            MetadataUtilities.setRouteIsLoggedIn(target.constructor, fullMetadata, propertyKey as string);
        }
        else {
            MetadataUtilities.setControllerIsLoggedIn(target as Function, fullMetadata);
        }
    };
    return decorator;
}) as IsLoggedInFn;
isLoggedInDecorator.skip = () => ((
    target: Object,
    propertyKey?: string | symbol
) => {
    if (propertyKey !== undefined) {
        MetadataUtilities.setRouteSkipIsLoggedIn(target.constructor, {}, propertyKey as string);
    }
    else {
        MetadataUtilities.setControllerSkipIsLoggedIn(target as Function, {});
    }
}) as MethodDecorator & ClassDecorator;