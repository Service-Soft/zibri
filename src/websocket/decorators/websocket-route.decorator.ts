import { MetadataUtilities } from '../../utilities';
import { WebsocketControllerRouteConfiguration } from '../models';

// eslint-disable-next-line jsdoc/require-returns
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