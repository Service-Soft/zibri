import { BodyMetadata } from './decorators/body.decorator';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata } from './decorators/param.decorator';
import { CurrentUserMetadata } from '../auth/decorators/current-user.decorator';
import { BaseUser } from '../auth/models/base-user.model';
import { HttpRequestContext } from '../context/request/http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../context/request/request-context-token.model';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { KnownHeader } from '../http/known-header.enum';
import { ParserInterface } from '../parsing/parser.interface';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { ValidationServiceInterface } from '../validation/validation-service.interface';
import { CurrentWebsocketConnectionMetadata } from '../websocket/decorators/current-websocket-connection.decorator';

// eslint-disable-next-line jsdoc/require-jsdoc
export async function resolveRouteParams(
    controllerClass: Newable<unknown>,
    controllerMethod: string,
    totalParamCount: number,
    context: HttpRequestContext | WebsocketRequestContext
): Promise<unknown[]> {
    const params: unknown[] = await parseRouteParams(controllerClass, controllerMethod, totalParamCount, context);

    const validationService: ValidationServiceInterface = inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE);

    // validate
    const pathParams: Record<string, PathParamMetadata> = MetadataUtilities.getRoutePathParams(controllerClass, controllerMethod);
    const queryParams: Record<string, QueryParamMetadata> = MetadataUtilities.getRouteQueryParams(controllerClass, controllerMethod);
    const headerParams: Record<string, HeaderParamMetadata> = MetadataUtilities.getRouteHeaderParams(controllerClass, controllerMethod);
    const requestBody: BodyMetadata | undefined = MetadataUtilities.getRouteBody(controllerClass, controllerMethod);

    await Promise.all([
        ...ObjectUtilities.entries(pathParams).map(async ([indexStr, metadata]) => {
            const idx: number = Number(indexStr);
            await validationService.validatePathParam(params[idx], metadata);
        }),
        ...ObjectUtilities.entries(queryParams).map(async ([indexStr, metadata]) => {
            const idx: number = Number(indexStr);
            await validationService.validateQueryParam(params[idx], metadata);
        }),
        ...ObjectUtilities.entries(headerParams).map(async ([indexStr, metadata]) => {
            const idx: number = Number(indexStr);
            await validationService.validateHeaderParam(params[idx], metadata);
        }),
        ...requestBody ? [validationService.validateBody(params[requestBody.index], requestBody)] : []
    ]);

    return params;
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function parseRouteParams(
    controllerClass: Newable<unknown>,
    controllerMethod: string,
    totalParamCount: number,
    context: HttpRequestContext | WebsocketRequestContext
): Promise<unknown[]> {
    const parser: ParserInterface = inject(ZIBRI_DI_TOKENS.PARSER);

    let resolvedParamCount: number = 0;
    const params: unknown[] = new Array(totalParamCount).fill(undefined);

    // 1) Path decorators
    const pathParams: Record<string, PathParamMetadata> = MetadataUtilities.getRoutePathParams(controllerClass, controllerMethod);
    for (const [indexStr, metadata] of ObjectUtilities.entries(pathParams)) {
        const idx: number = Number(indexStr);
        context.request.params ??= {};
        context.request.params[metadata.name] = parser.parsePathParam(context.request, metadata) as string | undefined;
        params[idx] = context.request.params[metadata.name];
    }
    resolvedParamCount += ObjectUtilities.keys(pathParams).length;

    // 2) Query decorators
    const queryParams: Record<string, QueryParamMetadata> = MetadataUtilities.getRouteQueryParams(controllerClass, controllerMethod);
    for (const [indexStr, metadata] of ObjectUtilities.entries(queryParams)) {
        const idx: number = Number(indexStr);
        context.request.query ??= {};
        context.request.query[metadata.name] = parser.parseQueryParam(context.request, metadata) as string | undefined;
        params[idx] = context.request.query[metadata.name];
    }
    resolvedParamCount += ObjectUtilities.keys(queryParams).length;

    // 3) Header decorators
    const headerParams: Record<string, HeaderParamMetadata> = MetadataUtilities.getRouteHeaderParams(controllerClass, controllerMethod);
    for (const [indexStr, metadata] of ObjectUtilities.entries(headerParams)) {
        const idx: number = Number(indexStr);
        context.request.headers[metadata.name as KnownHeader] = parser.parseHeaderParam(context.request, metadata) as string | undefined;
        params[idx] = context.request.headers[metadata.name as KnownHeader];
    }
    resolvedParamCount += ObjectUtilities.keys(headerParams).length;

    // 4) Body decorator
    const requestBody: BodyMetadata | undefined = MetadataUtilities.getRouteBody(controllerClass, controllerMethod);
    if (requestBody) {
        context.request.body = await parser.parseBody(context.request, requestBody);
        params[requestBody.index] = context.request.body;
        resolvedParamCount++;
    }

    // 5) CurrentUser decorator
    const currentUserMetadata: CurrentUserMetadata | undefined = MetadataUtilities.getRouteCurrentUser(controllerClass, controllerMethod);
    if (currentUserMetadata) {
        const currentUser: BaseUser<string> | undefined = await context.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_USER);
        params[currentUserMetadata.index] = currentUser;
        resolvedParamCount++;
    }

    // 6) CurrentWebsocketConnection decorator
    // eslint-disable-next-line stylistic/max-len
    const currentWebsocketConnectionMetadata: CurrentWebsocketConnectionMetadata | undefined = MetadataUtilities.getRouteCurrentWebsocketConnection(controllerClass, controllerMethod);
    if (currentWebsocketConnectionMetadata) {
        switch (context.type) {
            case 'http-request': {
                throw new Error('Tried to inject a websocket connection on a http request.');
            }
            case 'websocket-request': {
                params[currentWebsocketConnectionMetadata.index] = context.connection;
                break;
            }
        }
        resolvedParamCount++;
    }

    if (resolvedParamCount < totalParamCount) {
        throw new Error(
            // eslint-disable-next-line stylistic/max-len
            `Error when calling ${controllerClass.name}.${controllerMethod}: Could only resolve ${resolvedParamCount} out of ${totalParamCount} parameters. Did you forget to decorate one of the parameters?`
        );
    }

    return params;
}