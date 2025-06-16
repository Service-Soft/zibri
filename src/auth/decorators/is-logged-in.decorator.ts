import { MetadataUtilities } from '../../utilities';
import { AuthStrategies, IsLoggedInMetadata } from '../models';

export interface IsLoggedInFn {
    (allowedStrategies?: AuthStrategies): MethodDecorator & ClassDecorator,
    skip: () => MethodDecorator & ClassDecorator
}

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