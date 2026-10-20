import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { IsLoggedInMetadata } from '../models/is-logged-in-metadata.model.ts';
import { AuthStrategies } from '../strategies/auth-strategies.model.ts';

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
        target: object,
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
    target: object,
    propertyKey?: string | symbol
) => {
    if (propertyKey !== undefined) {
        MetadataUtilities.setRouteSkipIsLoggedIn(target.constructor, {}, propertyKey as string);
    }
    else {
        MetadataUtilities.setControllerSkipIsLoggedIn(target as Function, {});
    }
});