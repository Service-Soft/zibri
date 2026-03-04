import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { Route } from '../controller-route-configuration.model';

/**
 * Marks a controller class to be registered under the provided base route.
 * @param baseRoute - The base route of the controller. Any endpoints inside this class will be prefixed with this.
 */
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
        GlobalRegistry.controllerClasses.push(target as unknown as Newable<unknown>);
    };
}