import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { SupportedVersionsOptions } from '../../versioning/supported-versions-options.model';
import { WebsocketControllerRouteConfiguration } from '../models/websocket-controller-route-configuration.model';

/**
 * Options for a websocket route.
 */
export type WebsocketRouteOptions = {
    /**
     * The supported versions of this route.
     * Defaults to '^latest'.
     */
    versions?: SupportedVersionsOptions
};

/**
 * Defines a route to receive websocket messages.
 * @param event - The event to listen on.
 * @param options - The options of the route, like eg. The supported versions.
 */
export function WebsocketRoute(event: string, options: WebsocketRouteOptions = {}): MethodDecorator {
    return (target, propertyKey) => {
        const ctor: Function = target.constructor;
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(ctor, stack);
        const routes: WebsocketControllerRouteConfiguration[] = MetadataUtilities.getWebsocketControllerRoutes(ctor);
        routes.push({ event, controllerMethod: propertyKey.toString(), versions: options.versions });
        MetadataUtilities.setWebsocketControllerRoutes(ctor, routes);
    };
}