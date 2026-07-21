import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { IsNotLoggedInMetadata } from '../models/is-not-logged-in-metadata.model';
import { AuthStrategies } from '../strategies/auth-strategies.model';

/**
 * The type of the is not logged in decorator.
 */
export interface IsNotLoggedInFn {
    (allowedStrategies?: AuthStrategies): MethodDecorator & ClassDecorator,
    /**
     * This skips the is not logged in validation.
     */
    skip: () => MethodDecorator & ClassDecorator
}

/**
 * Marks an endpoint to be only reachable when there is no logged in user.
 * @param allowedStrategies - The auth strategies that are allowed to be used to check that.
 */
export const isNotLoggedInDecorator: IsNotLoggedInFn = ((allowedStrategies?: AuthStrategies) => {
    const fullMetadata: IsNotLoggedInMetadata = { allowedStrategies };

    const decorator: MethodDecorator & ClassDecorator = (
        target: Object,
        propertyKey?: string | symbol
    ) => {
        if (propertyKey !== undefined) {
            MetadataUtilities.setRouteIsNotLoggedIn(target.constructor, fullMetadata, propertyKey as string);
        }
        else {
            MetadataUtilities.setControllerIsNotLoggedIn(target as Function, fullMetadata);
        }
    };
    return decorator;
}) as IsNotLoggedInFn;
isNotLoggedInDecorator.skip = () => ((
    target: Object,
    propertyKey?: string | symbol
) => {
    if (propertyKey !== undefined) {
        MetadataUtilities.setRouteSkipIsNotLoggedIn(target.constructor, {}, propertyKey as string);
    }
    else {
        MetadataUtilities.setControllerSkipIsNotLoggedIn(target as Function, {});
    }
}) as MethodDecorator & ClassDecorator;