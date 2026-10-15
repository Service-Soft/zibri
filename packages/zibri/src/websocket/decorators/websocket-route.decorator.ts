import { HandlerTimeout } from '../../http/handler-timeout.type';
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
    versions?: SupportedVersionsOptions,
    /**
     * How long the handler of this route has to produce a result.
     *
     * Overrides what the controller says, which overrides the application's `handlerInMs`. Use
     * `'none'` for an event that legitimately takes as long as it takes.
     */
    timeoutInMs?: HandlerTimeout
};

/**
 * Defines a route to receive websocket messages.
 * @param event - The event to listen on.
 * @param options - The options of the route, like eg. The supported versions.
 */
export function WebsocketRoute(event: string, options: WebsocketRouteOptions = {}): MethodDecorator {
    return (target, propertyKey) => {
        const ctor: Function = target.constructor;
        MetadataUtilities.setFilePath(ctor);
        const routes: WebsocketControllerRouteConfiguration[] = MetadataUtilities.getWebsocketControllerRoutes(ctor);
        routes.push({
            event,
            controllerMethod: propertyKey.toString(),
            versions: options.versions,
            timeoutInMs: options.timeoutInMs
        });
        MetadataUtilities.setWebsocketControllerRoutes(ctor, routes);
    };
}