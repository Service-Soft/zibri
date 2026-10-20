import { RouteParamMetadata } from './route-param-metadata.model.ts';
import { BaseUser } from '../auth/models/base-user.model.ts';
import { HttpRequestContext } from '../context/request/http-request.context.ts';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../context/request/request-context-token.model.ts';
import { WebsocketRequestContext } from '../context/request/websocket-request.context.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { KnownHeader } from '../http/known-header.enum.ts';
import { ParserInterface } from '../parsing/parser.interface.ts';
import { ValidationServiceInterface } from '../validation/validation-service.interface.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
export async function resolveRouteParams(
    metadata: RouteParamMetadata,
    totalParamCount: number,
    context: HttpRequestContext | WebsocketRequestContext
): Promise<unknown[]> {
    const params: unknown[] = await parseRouteParams(metadata, totalParamCount, context);

    const validationService: ValidationServiceInterface = inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE);

    // validate
    await Promise.all([
        ...metadata.pathParams.map(async p => await validationService.validatePathParam(params[p.index], p.metadata)),
        ...metadata.queryParams.map(async p => await validationService.validateQueryParam(params[p.index], p.metadata)),
        ...metadata.headerParams.map(async p => await validationService.validateHeaderParam(params[p.index], p.metadata)),
        ...metadata.body ? [validationService.validateBody(params[metadata.body.index], metadata.body)] : []
    ]);

    return params;
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
async function parseRouteParams(
    metadata: RouteParamMetadata,
    totalParamCount: number,
    context: HttpRequestContext | WebsocketRequestContext
): Promise<unknown[]> {
    const parser: ParserInterface = inject(ZIBRI_DI_TOKENS.PARSER);

    const params: unknown[] = Array.from({length: totalParamCount}).fill(undefined);

    // 1) Path decorators
    for (const { index, metadata: pathParam } of metadata.pathParams) {
        context.request.params ??= {};
        context.request.params[pathParam.name] = parser.parsePathParam(context.request, pathParam) as string | undefined;
        params[index] = context.request.params[pathParam.name];
    }

    // 2) Query decorators
    for (const { index, metadata: queryParam } of metadata.queryParams) {
        context.request.query ??= {};
        context.request.query[queryParam.name] = parser.parseQueryParam(context.request, queryParam) as string | undefined;
        params[index] = context.request.query[queryParam.name];
    }

    // 3) Header decorators
    for (const { index, metadata: headerParam } of metadata.headerParams) {
        context.request.headers ??= {};
        const name: KnownHeader = headerParam.name as KnownHeader;
        context.request.headers[name] = parser.parseHeaderParam(context.request, headerParam) as string | undefined;
        params[index] = context.request.headers[name];
    }

    // 4) Body decorator
    if (metadata.body) {
        context.request.body = await parser.parseBody(context.request, metadata.body);
        params[metadata.body.index] = context.request.body;
    }

    // 5) CurrentUser decorator
    if (metadata.currentUser) {
        const currentUser: BaseUser<string> | undefined = await context.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_USER);
        params[metadata.currentUser.index] = currentUser;
    }

    // 6) CurrentWebsocketConnection decorator
    if (metadata.currentWebsocketConnection) {
        switch (context.type) {
            case 'http-request': {
                throw new InternalError('Tried to inject a websocket connection on a http request.');
            }
            case 'websocket-request': {
                params[metadata.currentWebsocketConnection.index] = context.connection;
                break;
            }
        }
    }

    if (metadata.declaredParamCount < totalParamCount) {
        throw new InternalError(
            `Error when calling ${metadata.controllerClass.name}.${metadata.controllerMethod}: Could only resolve ${metadata.declaredParamCount} out of ${totalParamCount} parameters. Did you forget to decorate one of the parameters?`
        );
    }

    return params;
}