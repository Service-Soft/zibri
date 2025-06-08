import { GlobalRegistry } from '../../global';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';
import { Route } from '../controller-route-configuration.model';

export function Controller(baseRoute: Route): ClassDecorator {
    return target => {
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        MetadataUtilities.setControllerBaseRoute(target, baseRoute);
        GlobalRegistry.injectables.push({
            token: target as unknown as Newable<unknown>,
            useClass: target as unknown as Newable<unknown>
        });
        GlobalRegistry.controllerClasses.push(target as unknown as Newable<Object>);
    };
}