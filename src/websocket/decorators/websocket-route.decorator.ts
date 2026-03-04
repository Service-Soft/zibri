import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { WebsocketControllerRouteConfiguration } from '../models/websocket-controller-route-configuration.model';

/**
 * Defines a route to receive websocket messages.
 * @param event - The event to listen on.
 */
export function WebsocketRoute(event: string): MethodDecorator {
    return (target, propertyKey) => {
        const ctor: Function = target.constructor;
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(ctor, stack);
        const routes: WebsocketControllerRouteConfiguration[] = MetadataUtilities.getWebsocketControllerRoutes(ctor);
        routes.push({ event, controllerMethod: propertyKey.toString() });
        MetadataUtilities.setWebsocketControllerRoutes(ctor, routes);
    };
}