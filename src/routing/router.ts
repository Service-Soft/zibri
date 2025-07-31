import { Readable } from 'stream';

import { NextFunction, RequestHandler, Router as ExpressRouter } from 'express';

import { Route, ControllerRouteConfiguration } from './controller-route-configuration.model';
import { RouterInterface } from './router.interface';
import { AuthServiceInterface, CurrentUserMetadata, JwtAuthController } from '../auth';
import { ZIBRI_DI_TOKENS, inject } from '../di';
import { MetadataUtilities, Ms } from '../utilities';
import { MissingBaseRouteError } from './missing-base-route.error';
import { ZibriApplication } from '../application';
import { GlobalRegistry } from '../global';
import { LoggerInterface } from '../logging';
import { Newable } from '../types';
import { BodyMetadata, BodyMetadataInput, HeaderParamMetadata, HeaderParamMetadataInput, PathParamMetadata, PathParamMetadataInput, QueryParamMetadata, QueryParamMetadataInput } from './decorators';
import { OpenApiRouteConfiguration, RouteConfiguration, RouteConfigurationInput } from './route-configuration.model';
import { HttpMethod, HttpRequest, HttpResponse, KnownHeader, MimeType } from '../http';
import { OpenApiResponse } from '../open-api';
import { FileResponse, HtmlResponse, ParserInterface } from '../parsing';
import { ValidationServiceInterface } from '../validation';
import { createHeaderParamMetadata, createPathParamMetadata, createQueryParamMetadata } from './param-metdata.helpers';

/**
 * Default router implementation of Zibri.
 */
export class Router implements RouterInterface {
    private readonly expressRouter: ExpressRouter = ExpressRouter();
    private readonly logger: LoggerInterface;
    private readonly parser: ParserInterface;
    private readonly validationService: ValidationServiceInterface;
    private readonly authService: AuthServiceInterface;
    private readonly allowedOrphans: Newable<unknown>[] = [JwtAuthController];
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly manuallyRegisteredRoutes: RouteConfiguration<
        BodyMetadata,
        Record<string, PathParamMetadata>,
        Record<string, QueryParamMetadata>,
        Record<string, HeaderParamMetadata>
    >[] = [];

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
        this.parser = inject(ZIBRI_DI_TOKENS.PARSER);
        this.validationService = inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE);
        this.authService = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async init(app: ZibriApplication): Promise<void> {
        await this.logger.info(`registers ${app.options.controllers.length} controllers:`);
        for (const controller of app.options.controllers) {
            const routes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(controller);
            await this.logger.info(`  - ${controller.name} (${routes.length} routes)`);
            await this.registerController(controller);
        }
        this.checkForOrphanedControllers(app.options.controllers);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    attachTo(app: ZibriApplication): void {
        app.use(this.expressRouter);
    }

    private checkForOrphanedControllers(controllers: Newable<unknown>[]): void {
        const orphanedControllers: Newable<unknown>[] = GlobalRegistry.controllerClasses.filter(c => {
            return !controllers.includes(c) && !this.allowedOrphans.includes(c);
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
    async register<
        // eslint-disable-next-line jsdoc/require-jsdoc
        BodyMetaInputObject extends BodyMetadataInput & { modelClass: Newable<unknown> },
        PathMetaInputObject extends Record<string, PathParamMetadataInput>,
        QueryMetaInputObject extends Record<string, QueryParamMetadataInput>,
        HeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>
    >(
        input: RouteConfigurationInput<BodyMetaInputObject, PathMetaInputObject, QueryMetaInputObject, HeaderMetaInputObject>
    ): Promise<void> {
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
        const baseRoute: Route | undefined = MetadataUtilities.getControllerBaseRoute(controllerClass);
        if (baseRoute == undefined) {
            throw new MissingBaseRouteError(controllerClass);
        }
        const routes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(controllerClass);

        for (const route of routes) {
            const handler: RequestHandler = await this.controllerRouteToRequestHandler(controllerClass, route);
            const finalRoute: string = `${baseRoute}${route.route}`;
            await this.logger.debug(`- mounting ${route.httpMethod.toUpperCase()} ${finalRoute}`);
            this.expressRouter[route.httpMethod](baseRoute + route.route, handler);
        }
    }

    private routeToRequestHandler<
        BodyMetaObject extends BodyMetadata,
        PathMetaObject extends Record<string, PathParamMetadata>,
        QueryMetaObject extends Record<string, QueryParamMetadata>,
        HeaderMetaObject extends Record<string, HeaderParamMetadata>
    >(route: RouteConfiguration<BodyMetaObject, PathMetaObject, QueryMetaObject, HeaderMetaObject>): RequestHandler {
        const handler: RequestHandler = (async (
            req: HttpRequest,
            res: HttpResponse,
            next: NextFunction
        ) => {
            try {
                if (route.bodyMetadata) {
                    req.body = await this.parser.parseRequestBody(req, route.bodyMetadata);
                    this.validationService.validateRequestBody(req.body, route.bodyMetadata);
                }
                for (const key in route.pathParams) {
                    (req.params[key] as unknown) = this.parser.parsePathParam(req, route.pathParams[key]);
                    this.validationService.validatePathParam(req.params[key], route.pathParams[key]);
                }
                for (const key in route.queryParams) {
                    (req.query[key] as unknown) = this.parser.parseQueryParam(
                        req,
                        route.queryParams[key]
                    );
                    this.validationService.validateQueryParam(req.query[key], route.queryParams[key]);
                }
                for (const key in route.headerParams) {
                    (req.headers[key] as unknown) = this.parser.parseHeaderParam(
                        req,
                        route.headerParams[key]
                    );
                    this.validationService.validateHeaderParam(req.headers[key], route.headerParams[key]);
                }
                // eslint-disable-next-line typescript/no-explicit-any
                const result: unknown = await route.handler(req as HttpRequest<any, any, any, any>, res, next);
                this.returnResult(res, result, next);
            }
            catch (error) {
                next(error);
            }
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
            try {
                await this.authService.checkAccess(controllerClass, route.controllerMethod, req);
                const controller: unknown = inject(controllerClass);
                const params: unknown[] = await this.resolveRouteParams(
                    controllerClass,
                    route.controllerMethod,
                    // eslint-disable-next-line typescript/no-unsafe-member-access, typescript/no-explicit-any
                    ((controller as any)[route.controllerMethod] as Function).length,
                    req
                );

                // eslint-disable-next-line typescript/no-unsafe-call, typescript/no-explicit-any, typescript/no-unsafe-member-access
                const result: unknown = await ((controller as any)[route.controllerMethod] as Function)(...params);
                this.returnResult(res, result, next);
            }
            catch (error) {
                next(error);
            }
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

    private async resolveRouteParams(
        controllerClass: Newable<unknown>,
        controllerMethod: string,
        totalParamCount: number,
        req: HttpRequest
    ): Promise<unknown[]> {
        let resolvedParamCount: number = 0;
        const params: unknown[] = new Array(totalParamCount).fill(undefined);

        // 1) Path decorators
        const pathParams: Record<string, PathParamMetadata> = MetadataUtilities.getRoutePathParams(controllerClass, controllerMethod);
        for (const [indexStr, metadata] of Object.entries(pathParams)) {
            const idx: number = Number(indexStr);
            params[idx] = this.parser.parsePathParam(req, metadata);
            this.validationService.validatePathParam(params[idx], metadata);
        }
        resolvedParamCount += Object.keys(pathParams).length;

        // 2) Body decorator
        const requestBody: BodyMetadata | undefined = MetadataUtilities.getRouteBody(controllerClass, controllerMethod);
        if (requestBody) {
            resolvedParamCount++;
            params[requestBody.index] = await this.parser.parseRequestBody(req, requestBody);
            this.validationService.validateRequestBody(params[requestBody.index], requestBody);
        }

        // 3) Query decorators
        const queryParams: Record<string, QueryParamMetadata> = MetadataUtilities.getRouteQueryParams(controllerClass, controllerMethod);
        for (const [indexStr, metadata] of Object.entries(queryParams)) {
            const idx: number = Number(indexStr);
            params[idx] = this.parser.parseQueryParam(req, metadata);
            this.validationService.validateQueryParam(params[idx], metadata);
        }
        resolvedParamCount += Object.keys(queryParams).length;

        // 3) Header decorators
        const headerParams: Record<string, HeaderParamMetadata> = MetadataUtilities.getRouteHeaderParams(controllerClass, controllerMethod);
        for (const [indexStr, metadata] of Object.entries(headerParams)) {
            const idx: number = Number(indexStr);
            params[idx] = this.parser.parseHeaderParam(req, metadata);
            this.validationService.validateHeaderParam(params[idx], metadata);
        }
        resolvedParamCount += Object.keys(headerParams).length;

        // 4) CurrentUser decorator
        const currentUser: CurrentUserMetadata | undefined = MetadataUtilities.getRouteCurrentUser(controllerClass, controllerMethod);
        if (currentUser) {
            resolvedParamCount++;
            params[currentUser.index] = await this.authService.getCurrentUser(
                req,
                currentUser.allowedStrategies ?? this.authService.strategies,
                currentUser.required
            );
        }

        if (resolvedParamCount < totalParamCount) {
            throw new Error(
                // eslint-disable-next-line stylistic/max-len
                `Error when calling ${controllerClass.name}.${controllerMethod}: Could only resolve ${resolvedParamCount} out of ${totalParamCount} parameters. Did you forget to decorate one of the parameters?`
            );
        }

        return params;
    }
}