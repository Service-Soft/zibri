import { AuthServiceInterface, CurrentUserMetadata } from '../auth';
import { HttpRequest } from '../http';
import { ParserInterface } from '../parsing';
import { Newable } from '../types';
import { MetadataUtilities, ObjectUtilities } from '../utilities';
import { ValidationServiceInterface } from '../validation';
import { BaseWebsocketConnection, CurrentWebsocketConnectionMetadata, WebsocketRequest } from '../websocket';
import { BodyMetadata, HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from './decorators';

// eslint-disable-next-line jsdoc/require-jsdoc
export async function resolveRouteParams(
    controllerClass: Newable<unknown>,
    controllerMethod: string,
    totalParamCount: number,
    req: HttpRequest | WebsocketRequest,
    parser: ParserInterface,
    validationService: ValidationServiceInterface,
    authService: AuthServiceInterface,
    currentWebsocketConnection: BaseWebsocketConnection | undefined
): Promise<unknown[]> {
    // TODO: validate that no additional parameters have been provided that are unused in the controller.

    let resolvedParamCount: number = 0;
    const params: unknown[] = new Array(totalParamCount).fill(undefined);

    // 1) Path decorators
    const pathParams: Record<string, PathParamMetadata> = MetadataUtilities.getRoutePathParams(controllerClass, controllerMethod);
    for (const [indexStr, metadata] of ObjectUtilities.entries(pathParams)) {
        const idx: number = Number(indexStr);
        params[idx] = parser.parsePathParam(req, metadata);
        validationService.validatePathParam(params[idx], metadata);
    }
    resolvedParamCount += ObjectUtilities.keys(pathParams).length;

    // 2) Body decorator
    const requestBody: BodyMetadata | undefined = MetadataUtilities.getRouteBody(controllerClass, controllerMethod);
    if (requestBody) {
        resolvedParamCount++;
        params[requestBody.index] = await parser.parseBody(req, requestBody);
        validationService.validateBody(params[requestBody.index], requestBody);
    }

    // 3) Query decorators
    const queryParams: Record<string, QueryParamMetadata> = MetadataUtilities.getRouteQueryParams(controllerClass, controllerMethod);
    for (const [indexStr, metadata] of ObjectUtilities.entries(queryParams)) {
        const idx: number = Number(indexStr);
        params[idx] = parser.parseQueryParam(req, metadata);
        validationService.validateQueryParam(params[idx], metadata);
    }
    resolvedParamCount += ObjectUtilities.keys(queryParams).length;

    // 3) Header decorators
    const headerParams: Record<string, HeaderParamMetadata> = MetadataUtilities.getRouteHeaderParams(controllerClass, controllerMethod);
    for (const [indexStr, metadata] of ObjectUtilities.entries(headerParams)) {
        const idx: number = Number(indexStr);
        params[idx] = parser.parseHeaderParam(req, metadata);
        validationService.validateHeaderParam(params[idx], metadata);
    }
    resolvedParamCount += ObjectUtilities.keys(headerParams).length;

    // 4) CurrentUser decorator
    const currentUser: CurrentUserMetadata | undefined = MetadataUtilities.getRouteCurrentUser(controllerClass, controllerMethod);
    if (currentUser) {
        resolvedParamCount++;
        params[currentUser.index] = await authService.getCurrentUser(
            req,
            currentUser.allowedStrategies ?? authService.strategies,
            currentUser.required
        );
    }

    // 4) CurrentWebsocketConnection decorator
    // eslint-disable-next-line stylistic/max-len
    const currentWebsocketConnectionMetadata: CurrentWebsocketConnectionMetadata | undefined = MetadataUtilities.getRouteCurrentWebsocketConnection(controllerClass, controllerMethod);
    if (currentWebsocketConnectionMetadata) {
        resolvedParamCount++;
        params[currentWebsocketConnectionMetadata.index] = currentWebsocketConnection;
    }

    if (resolvedParamCount < totalParamCount) {
        throw new Error(
            // eslint-disable-next-line stylistic/max-len
            `Error when calling ${controllerClass.name}.${controllerMethod}: Could only resolve ${resolvedParamCount} out of ${totalParamCount} parameters. Did you forget to decorate one of the parameters?`
        );
    }

    return params;
}