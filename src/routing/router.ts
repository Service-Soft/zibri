import { Readable } from 'stream';

import { NextFunction, RequestHandler, Router as ExpressRouter } from 'express';

import { ControllerRouteConfiguration } from './controller-route-configuration.model';
import { BodyMetadata, BodyMetadataInput, resolveMaxBodySize } from './decorators/body.decorator';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata, PathParamMetadataInput, QueryParamMetadataInput, HeaderParamMetadataInput } from './decorators/param.decorator';
import { MissingBaseRouteError } from './missing-base-route.error';
import { createHeaderParamMetadata, createPathParamMetadata, createQueryParamMetadata } from './param-metdata.helpers';
import { RouterInterface } from './router.interface';
import { ZibriApplication } from '../application';
import { resolveRouteParams } from './resolve-route-params.function';
import { OpenApiRouteConfiguration, RouteConfiguration, RouteConfigurationInput } from './route-configuration.model';
import type { AuthServiceInterface } from '../auth/auth-service.interface';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { GlobalRegistry } from '../global/global-registry';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppStart } from '../global/on-app-start.interface';
import { HttpMethod } from '../http/http-method.enum';
import { HttpRequest } from '../http/http-request.model';
import { HttpResponse } from '../http/http-response.model';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { type LoggerInterface } from '../logging/logger.interface';
import { OpenApiResponse } from '../open-api/open-api.model';
import { FileResponse } from '../parsing/form-data/file-response.model';
import { HtmlResponse } from '../parsing/html/html-response.model';
import type { ParserInterface } from '../parsing/parser.interface';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { Ms } from '../utilities/ms';
import type { ValidationServiceInterface } from '../validation/validation-service.interface';
import { ControllerData } from './decorators/controller.decorator';
import { AlsUtilities } from '../context/als.utilities';
import { HttpRequestContext } from '../context/request/http-request.context';
import { ObjectUtilities } from '../utilities/object.utilities';

/**
 * Default router implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class Router implements RouterInterface, OnAppInit, OnAppStart {
    private readonly expressRouter: ExpressRouter = ExpressRouter();
    private readonly allBaseRoutes: string[] = [];
    private readonly allFinalRoutes: string[] = [];
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly manuallyRegisteredRoutes: RouteConfiguration<
        BodyMetadata,
        Record<string, PathParamMetadata>,
        Record<string, QueryParamMetadata>,
        Record<string, HeaderParamMetadata>
    >[] = [];

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.PARSER)
        private readonly parser: ParserInterface,
        @Inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE)
        private readonly validationService: ValidationServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        private readonly authService: AuthServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        await this.logger.info(`registers ${app.options.controllers.length} controllers:`);
        for (const controller of app.options.controllers) {
            const routes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(controller);
            await this.logger.info(`  - ${controller.name} (${routes.length} routes)`);
            await this.registerController(controller);
        }
        this.checkForOrphanedControllers(app.options.controllers);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppStart(app: ZibriApplication): void {
        app.use(this.expressRouter);
    }

    private checkForOrphanedControllers(controllers: Newable<unknown>[]): void {
        const orphanedControllers: Newable<unknown>[] = GlobalRegistry.controllerClasses.filter(c => {
            return !controllers.includes(c) && !(MetadataUtilities.getControllerData(c)?.allowOrphan ?? false);
        });
        if (orphanedControllers.length) {
            const message: string[] = ['Error initializing router.', 'Found orphaned controllers:'];
            for (const controller of orphanedControllers) {
                message.push(`  - ${controller.name}`);
            }
            message.push('Did you forget to add them to your controllers array?');
            throw new Error(message.join('\n'));
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async registerRoute<
        // eslint-disable-next-line jsdoc/require-jsdoc
        BodyMetaInputObject extends BodyMetadataInput & { modelClass: Newable<unknown> },
        PathMetaInputObject extends Record<string, PathParamMetadataInput>,
        QueryMetaInputObject extends Record<string, QueryParamMetadataInput>,
        HeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>
    >(
        input: RouteConfigurationInput<BodyMetaInputObject, PathMetaInputObject, QueryMetaInputObject, HeaderMetaInputObject>
    ): Promise<void> {
        if (this.allFinalRoutes.includes(`${input.httpMethod.toUpperCase()} ${input.route}`)) {
            throw new Error(`The route "${input.httpMethod.toUpperCase()} ${input.route}" has been defined more than once.`);
        }
        this.allFinalRoutes.push(`${input.httpMethod.toUpperCase()} ${input.route}`);

        const pathParams: Record<string, PathParamMetadata> = {};
        for (const key in input.pathParams) {
            pathParams[key] = createPathParamMetadata(key, input.pathParams[key]);
        }
        const queryParams: Record<string, QueryParamMetadata> = {};
        for (const key in input.queryParams) {
            queryParams[key] = createQueryParamMetadata(key, input.queryParams[key]);
        }
        const headerParams: Record<string, HeaderParamMetadata> = {};
        for (const key in input.headerParams) {
            headerParams[key] = createHeaderParamMetadata(key, input.headerParams[key]);
        }

        // eslint-disable-next-line typescript/no-explicit-any
        const route: RouteConfiguration<any, any, any, any> = {
            ...input,
            openApi: this.createOpenApiRouteConfiguration(input.openApi, input.httpMethod),
            bodyMetadata: input.bodyMetadata
                ? {
                    index: 0,
                    required: true,
                    description: undefined,
                    type: MimeType.JSON,
                    cleanupAfterMs: Ms.DAY,
                    isArray: false,
                    allowAdditionalProperties: false,
                    maxSize: resolveMaxBodySize(input.bodyMetadata.modelClass, input.bodyMetadata.baseMaxSize),
                    ...input.bodyMetadata
                }
                : undefined,
            pathParams,
            queryParams,
            headerParams
        };
        const handler: RequestHandler = this.routeToRequestHandler(route);
        await this.logger.debug(`- mounting ${route.httpMethod.toUpperCase()} ${route.route}`);
        this.manuallyRegisteredRoutes.push(
            route as RouteConfiguration<
                BodyMetadata,
                Record<string, PathParamMetadata>,
                Record<string, QueryParamMetadata>,
                Record<string, HeaderParamMetadata>
            >
        );
        this.expressRouter[route.httpMethod](route.route, handler);
    }

    private createOpenApiRouteConfiguration(
        input: Partial<OpenApiRouteConfiguration> & Pick<OpenApiRouteConfiguration, 'useInOpenApi'> | undefined,
        httpMethod: HttpMethod
    ): OpenApiRouteConfiguration {
        if (input?.useInOpenApi === true) {
            return {
                responses: [],
                tags: [],
                ...input
            };
        }

        if (input) {
            return input;
        }

        switch (httpMethod) {
            case HttpMethod.HEAD:
            case HttpMethod.OPTIONS:
            case HttpMethod.TRACE:
            case HttpMethod.GET: {
                return { useInOpenApi: false };
            }
            case HttpMethod.POST:
            case HttpMethod.PUT:
            case HttpMethod.PATCH:
            case HttpMethod.DELETE: {
                return {
                    responses: [],
                    tags: [],
                    useInOpenApi: true
                };
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async registerController(controllerClass: Newable<unknown>): Promise<void> {
        const controllerData: ControllerData | undefined = MetadataUtilities.getControllerData(controllerClass);
        if (controllerData == undefined) {
            throw new MissingBaseRouteError(controllerClass);
        }
        if (this.allBaseRoutes.includes(controllerData.baseRoute)) {
            throw new Error(`The base route "${controllerData.baseRoute}" has been defined on more than one controller.`);
        }
        this.allBaseRoutes.push(controllerData.baseRoute);
        const routes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(controllerClass);

        for (const route of routes) {
            const handler: RequestHandler = await this.controllerRouteToRequestHandler(controllerClass, route);
            const finalRoute: string = controllerData.baseRoute === '/' ? route.route : `${controllerData.baseRoute}${route.route}`;
            if (this.allFinalRoutes.includes(`${route.httpMethod.toUpperCase()} ${finalRoute}`)) {
                throw new Error(
                    `The route "${route.httpMethod.toUpperCase()} ${finalRoute}" has been defined more than once.`,
                    { cause: controllerClass }
                );
            }
            this.allFinalRoutes.push(`${route.httpMethod.toUpperCase()} ${finalRoute}`);
            await this.logger.debug(`- mounting ${route.httpMethod.toUpperCase()} ${finalRoute}`);
            this.expressRouter[route.httpMethod](finalRoute, handler);
        }
    }

    private routeToRequestHandler<
        BodyMetaObject extends BodyMetadata,
        PathMetaObject extends Record<string, PathParamMetadata>,
        QueryMetaObject extends Record<string, QueryParamMetadata>,
        HeaderMetaObject extends Record<string, HeaderParamMetadata>
    >(route: RouteConfiguration<BodyMetaObject, PathMetaObject, QueryMetaObject, HeaderMetaObject>): RequestHandler {
        const handler: RequestHandler = (async (
            request: HttpRequest,
            res: HttpResponse,
            next: NextFunction
        ) => {
            const context: HttpRequestContext = new HttpRequestContext(request, undefined, undefined);
            await AlsUtilities.runWithHttpRequestContext(context, async () => {
                try {
                    // parse
                    for (const key of ObjectUtilities.keys(route.pathParams)) {
                        (context.request.params[key] as unknown) = this.parser.parsePathParam(context.request, route.pathParams[key]);
                    }
                    for (const key of ObjectUtilities.keys(route.queryParams)) {
                        (context.request.query[key] as unknown) = this.parser.parseQueryParam(
                            context.request,
                            route.queryParams[key]
                        );
                    }
                    for (const key of ObjectUtilities.keys(route.headerParams)) {
                        (context.request.headers[key] as unknown) = this.parser.parseHeaderParam(
                            context.request,
                            route.headerParams[key]
                        );
                    }
                    if (route.bodyMetadata) {
                        context.request.body = await this.parser.parseBody(context.request, route.bodyMetadata);
                    }
                    // validate
                    await Promise.all([
                        ...ObjectUtilities.keys(route.pathParams).map(async key => {
                            await this.validationService.validatePathParam(context.request.params[key], route.pathParams[key]);
                        }),
                        ...ObjectUtilities.keys(route.queryParams).map(async key => {
                            await this.validationService.validateQueryParam(context.request.query[key], route.queryParams[key]);
                        }),
                        ...ObjectUtilities.keys(route.headerParams).map(async key => {
                            await this.validationService.validateHeaderParam(context.request.headers[key], route.headerParams[key]);
                        }),
                        ...route.bodyMetadata ? [this.validationService.validateBody(context.request.body, route.bodyMetadata)] : []
                    ]);

                    // eslint-disable-next-line typescript/no-explicit-any
                    const result: unknown = await route.handler(context.request as HttpRequest<any, any, any, any>, res, next);
                    this.returnResult(res, result, next);
                }
                catch (error) {
                    next(error);
                }
            });
        }) as RequestHandler;
        return handler;
    }

    private async controllerRouteToRequestHandler(
        controllerClass: Newable<unknown>,
        route: ControllerRouteConfiguration
    ): Promise<RequestHandler> {
        const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(controllerClass, route.controllerMethod);
        if (!responses.length) {
            await this.logger.warn(`No responses defined on route ${controllerClass.name}.${route.controllerMethod}`);
        }
        const handler: RequestHandler = (async (req: HttpRequest, res: HttpResponse, next: NextFunction) => {
            const context: HttpRequestContext = new HttpRequestContext(req, controllerClass, route.controllerMethod);
            await AlsUtilities.runWithHttpRequestContext(context, async () => {
                try {
                    await this.authService.checkAccess(controllerClass, route.controllerMethod, context);
                    const controller: unknown = inject(controllerClass);
                    const params: unknown[] = await resolveRouteParams(
                        controllerClass,
                        route.controllerMethod,
                        // eslint-disable-next-line typescript/no-unsafe-member-access, typescript/no-explicit-any
                        ((controller as any)[route.controllerMethod] as Function).length,
                        context
                    );

                    // eslint-disable-next-line typescript/no-unsafe-call, typescript/no-explicit-any, typescript/no-unsafe-member-access
                    const result: unknown = await ((controller as any)[route.controllerMethod] as Function)(...params);
                    this.returnResult(res, result, next);
                }
                catch (error) {
                    next(error);
                }
            });
        }) as RequestHandler;
        return handler;
    }

    private returnResult(res: HttpResponse, result: unknown, next: NextFunction): void {
        if (res.headersSent) {
            return;
        }
        if (result == undefined) {
            res.end();
            return;
        }

        // if (
        //     responses.length // all non error responses are json responses
        //     && responses.filter(r => r.type !== 'error').length === responses.filter(r => r.type === 'json').length
        //     && ((result instanceof FileResponse) || (result instanceof HtmlResponse))
        // ) {
        //     throw new Error('Invalid return value, json cannot be FileResponse or HtmlResponse');
        // }

        // if (
        //     responses.length // all non error responses are file responses
        //     && responses.filter(r => r.type !== 'error').length === responses.filter(r => r.type === 'file').length
        //     && !(result instanceof FileResponse)
        // ) {
        //     throw new Error('Invalid return value, needs to be a FileResponse');
        // }

        // if (
        //     responses.length // all non error responses are html responses
        //     && responses.filter(r => r.type !== 'error').length === responses.filter(r => r.type === 'html').length
        //     && !(result instanceof FileResponse)
        // ) {
        //     throw new Error('Invalid return value, needs to be a HtmlResponse');
        // }

        if (result instanceof FileResponse) {
            res.setHeader(KnownHeader.CONTENT_TYPE, result.mimeType as MimeType);
            res.setHeader(KnownHeader.CONTENT_DISPOSITION, `attachment; filename="${encodeURIComponent(result.filename)}"`);
            if (result.size != undefined) {
                res.setHeader(KnownHeader.CONTENT_LENGTH, result.size);
            }

            // send file from disk
            if (typeof result.data === 'string') {
                res.sendFile(result.data);
                return;
            }

            // send file as stream
            res.on('close', () => (result.data as Readable).destroy());
            result.data.on('error', err => {
                res.removeHeader(KnownHeader.CONTENT_TYPE);
                res.removeHeader(KnownHeader.CONTENT_LENGTH);
                res.removeHeader(KnownHeader.CONTENT_DISPOSITION);
                next(err);
            }).pipe(res);
            return;
        }

        if (result instanceof HtmlResponse) {
            res.setHeader(KnownHeader.CONTENT_TYPE, MimeType.HTML);
            // send html as string
            if (typeof result.data === 'string') {
                res.type('.html').send(result.data);
                return;
            }
            // send html as stream
            res.on('close', () => (result.data as Readable).destroy());
            result.data.on('error', err => {
                res.removeHeader(KnownHeader.CONTENT_TYPE);
                next(err);
            }).pipe(res);
            return;
        }

        res.json(result);
    }
}