import { MetadataUtilities } from '../../utilities';
import { AuthStrategies, IsNotLoggedInMetadata } from '../models';

export interface IsNotLoggedInFn {
    (allowedStrategies?: AuthStrategies): MethodDecorator & ClassDecorator,
    skip: () => MethodDecorator & ClassDecorator
}

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