import { HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from './decorators/param.decorator';
import { CurrentUserMetadata } from '../auth/decorators/current-user.decorator';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { BodyMetadata } from './decorators/body-metadata.model';
import { CurrentWebsocketConnectionMetadata } from '../websocket/decorators/current-websocket-connection.decorator';

/**
 * One decorated parameter of a route handler, with the position it fills already read off the key it
 * was stored under.
 */
export type RouteParam<T> = {
    /**
     * Where in the handler's signature the parameter sits.
     */
    readonly index: number,
    /**
     * What the decorator said about it.
     */
    readonly metadata: T
};

/**
 * Everything the parameters of one route handler were declared as.
 *
 * Read once, when the route is registered: the decorators ran at module load and nothing can change
 * what they said afterwards, so a request only has to be handed the answer.
 */
export type RouteParamMetadata = {
    /**
     * The controller the route is on. Only used to name it when a parameter cannot be resolved.
     */
    readonly controllerClass: Newable<unknown>,
    /**
     * The method that handles the route.
     */
    readonly controllerMethod: string,
    /**
     * The parameters filled from the path.
     */
    readonly pathParams: RouteParam<PathParamMetadata>[],
    /**
     * The parameters filled from the query string.
     */
    readonly queryParams: RouteParam<QueryParamMetadata>[],
    /**
     * The parameters filled from a header.
     */
    readonly headerParams: RouteParam<HeaderParamMetadata>[],
    /**
     * The parameter filled from the request body, if the route takes one.
     */
    readonly body: BodyMetadata | undefined,
    /**
     * The parameter filled with the caller, if the route asks for one.
     */
    readonly currentUser: CurrentUserMetadata | undefined,
    /**
     * The parameter filled with the connection, if the route asks for one.
     */
    readonly currentWebsocketConnection: CurrentWebsocketConnectionMetadata | undefined,
    /**
     * How many parameters the declarations above account for.
     */
    readonly declaredParamCount: number
};

/**
 * Reads what the parameters of one route handler were declared as.
 * @param controllerClass - The controller the route is on.
 * @param controllerMethod - The method that handles the route.
 * @returns The declarations, in the shape a request is served from.
 */
export function resolveRouteParamMetadata(controllerClass: Newable<unknown>, controllerMethod: string): RouteParamMetadata {
    const pathParams: RouteParam<PathParamMetadata>[] = toRouteParams(
        MetadataUtilities.getRoutePathParams(controllerClass, controllerMethod)
    );
    const queryParams: RouteParam<QueryParamMetadata>[] = toRouteParams(
        MetadataUtilities.getRouteQueryParams(controllerClass, controllerMethod)
    );
    const headerParams: RouteParam<HeaderParamMetadata>[] = toRouteParams(
        MetadataUtilities.getRouteHeaderParams(controllerClass, controllerMethod)
    );
    const body: BodyMetadata | undefined = MetadataUtilities.getRouteBody(controllerClass, controllerMethod);
    const currentUser: CurrentUserMetadata | undefined = MetadataUtilities.getRouteCurrentUser(controllerClass, controllerMethod);
    const currentWebsocketConnection: CurrentWebsocketConnectionMetadata | undefined
        = MetadataUtilities.getRouteCurrentWebsocketConnection(controllerClass, controllerMethod);

    return {
        controllerClass,
        controllerMethod,
        pathParams,
        queryParams,
        headerParams,
        body,
        currentUser,
        currentWebsocketConnection,
        declaredParamCount: pathParams.length
            + queryParams.length
            + headerParams.length
            + (body ? 1 : 0)
            + (currentUser ? 1 : 0)
            + (currentWebsocketConnection ? 1 : 0)
    };
}

/**
 * Turns a record keyed by parameter position into the list a request is served from.
 * @param params - What the decorators stored.
 * @returns The same declarations, with their positions read as numbers.
 */
function toRouteParams<T>(params: Record<string, T>): RouteParam<T>[] {
    return ObjectUtilities.entries(params).map(([index, metadata]) => ({ index: Number(index), metadata }));
}