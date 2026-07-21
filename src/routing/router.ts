import assert from 'node:assert';
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
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../context/request/request-context-token.model';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { getDiTokenName } from '../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../di/get-registered-providers-of-variant.function';
import { inject } from '../di/inject.function';
import { DiProvider } from '../di/models/di-provider.model';
import { DiVariants } from '../di/models/di-variant.model';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { InternalError } from '../error-handling/internal-error.model';
import { GlobalRegistry } from '../global/global-registry';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppStart } from '../global/on-app-start.interface';
import { HttpMethod } from '../http/http-method.enum';
import { HttpRequest } from '../http/http-request.model';
import { HttpResponse } from '../http/http-response.model';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { $ts } from '../localization/translate.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { OpenApiResponse } from '../open-api/open-api.model';
import { FileResponse } from '../parsing/form-data/file-response.model';
import { buildCspHeaders, CspOptions, CspSource } from '../parsing/html/csp-options.model';
import { HtmlResponse } from '../parsing/html/html-response.model';
import type { ParserInterface } from '../parsing/parser.interface';
import { isNewable, Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { Ms } from '../utilities/ms';
import { SemVerVersion } from '../utilities/sem-ver.utilities';
import type { ValidationServiceInterface } from '../validation/validation-service.interface';
import { ControllerData } from './decorators/controller.decorator';
import { AlsUtilities } from '../context/als.utilities';
import { HttpRequestContext } from '../context/request/http-request.context';
import { JsonUtilities } from '../utilities/json.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { RouteWithVersionData } from '../versioning/route-with-version-data.model';
import { SupportedVersionsOptions } from '../versioning/supported-versions-options.model';
import { Version } from '../versioning/version.model';
import { type VersioningServiceInterface } from '../versioning/versioning-service.interface';

/**
 * Handler for a specific route and version.
 */
type ControllerInnerHandler = (context: HttpRequestContext, next: NextFunction) => Promise<void>;

/**
 * An error to throw during router initialization.
 */
class InitRouterError extends InternalError {
    constructor(message: string | string[]) {
        const messageArray: string[] = typeof message === 'string' ? [message] : message;
        super(['Error initializing router.', ...messageArray]);
        this.name = 'InitRouterError';
    }
}

/**
 * Default router implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class Router implements RouterInterface, OnAppInit, OnAppStart {
    private readonly expressRouter: ExpressRouter = ExpressRouter();
    private readonly allBaseRoutes: RouteWithVersionData[] = [];
    private readonly allFinalRoutes: RouteWithVersionData[] = [];
    private initComplete: boolean = false;
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly manuallyRegisteredRoutes: RouteConfiguration<
        BodyMetadata,
        Record<string, PathParamMetadata>,
        Record<string, QueryParamMetadata>,
        Record<string, HeaderParamMetadata>
    >[] = [];
    private readonly pendingRouteGroups: Map<string, {
        // eslint-disable-next-line jsdoc/require-jsdoc
        httpMethod: HttpMethod,
        // eslint-disable-next-line jsdoc/require-jsdoc
        finalRoute: string,
        // eslint-disable-next-line jsdoc/require-jsdoc
        entries: { versions: SupportedVersionsOptions, innerHandler: ControllerInnerHandler }[]
    }> = new Map();

    private get versioningService(): VersioningServiceInterface {
        return inject(ZIBRI_DI_TOKENS.VERSIONING_SERVICE);
    }

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

        for (const group of this.pendingRouteGroups.values()) {
            const dispatchHandler: RequestHandler = this.createDispatchHandler(group.entries);
            await this.logger.debug(`- mounting ${group.httpMethod.toUpperCase()} ${group.finalRoute}`);
            this.expressRouter[group.httpMethod](group.finalRoute, dispatchHandler);
        }
        this.initComplete = true;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppStart(app: ZibriApplication): void {
        app.use(this.expressRouter);
    }

    private checkForOrphanedControllers(controllers: Newable<unknown>[]): void {
        const orphanedControllers: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.CONTROLLER).filter(c => {
            return isNewable(c.useClass)
                && !controllers.includes(c.useClass)
                && !(MetadataUtilities.getControllerData(c.useClass)?.allowOrphan ?? false);
        });
        if (orphanedControllers.length) {
            throw new InitRouterError([
                'Found orphaned controllers:',
                ...orphanedControllers.map(c => `  - ${getDiTokenName(c.token)}`),
                'Did you forget to add them to your controllers array?'
            ]);
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
        const key: string = `${input.httpMethod.toUpperCase()} ${input.route}`;
        const versions: SupportedVersionsOptions = input.versions ?? ['^latest'];
        const currentLatest: SemVerVersion | undefined = GlobalRegistry.getAppData('version');
        assert(currentLatest);

        const overlappingRoute: RouteWithVersionData | undefined = this.allFinalRoutes.find(
            r => r.key === key && this.versioningService.hasOverlappingVersions(r.versions, versions, currentLatest)
        );
        if (overlappingRoute) {
            const overlappingVersions: SupportedVersionsOptions = this.versioningService.findOverlappingVersions(
                overlappingRoute.versions,
                versions,
                currentLatest
            );
            if (overlappingVersions === 'all') {
                throw new InitRouterError([
                    `The route "${key}"`,
                    // eslint-disable-next-line sonar/no-duplicate-string
                    'has been defined more than once.',
                    // eslint-disable-next-line sonar/no-duplicate-string
                    '(versions: \'all\' has been used)'
                ].join(' '));
            }

            throw new InitRouterError([
                `The route "${key}"`,
                `for the ${overlappingVersions.length > 1 ? 'versions' : 'version'} "${overlappingVersions.join(', ')}"`,
                'has been defined more than once.'
            ].join(' '));
        }
        this.allFinalRoutes.push({ key, versions });

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
            versions: ['^latest'],
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

        await this.logger.debug(`- mounting ${key}`);
        this.manuallyRegisteredRoutes.push(
            route as RouteConfiguration<
                BodyMetadata,
                Record<string, PathParamMetadata>,
                Record<string, QueryParamMetadata>,
                Record<string, HeaderParamMetadata>
            >
        );

        const innerHandler: ControllerInnerHandler = this.createManualRouteInnerHandler(route);
        // eslint-disable-next-line typescript/typedef
        const existing = this.pendingRouteGroups.get(key);
        if (existing) {
            existing.entries.push({ versions, innerHandler });
        }
        else {
            this.pendingRouteGroups.set(key, {
                httpMethod: input.httpMethod,
                finalRoute: input.route,
                entries: [{ versions, innerHandler }]
            });
        }

        // If init has already completed, mount immediately since the deferred loop has already run
        if (this.initComplete) {
            // eslint-disable-next-line typescript/typedef, typescript/no-non-null-assertion
            const group = this.pendingRouteGroups.get(key)!;
            this.expressRouter[input.httpMethod](input.route, this.createDispatchHandler(group.entries));
        }
    }

    private createManualRouteInnerHandler<
        BodyMetaObject extends BodyMetadata,
        PathMetaObject extends Record<string, PathParamMetadata>,
        QueryMetaObject extends Record<string, QueryParamMetadata>,
        HeaderMetaObject extends Record<string, HeaderParamMetadata>
    >(route: RouteConfiguration<BodyMetaObject, PathMetaObject, QueryMetaObject, HeaderMetaObject>): ControllerInnerHandler {
        return async (context: HttpRequestContext, next: NextFunction) => {
            try {
                for (const key of ObjectUtilities.keys(route.pathParams)) {
                    (context.request.params[key] as unknown) = this.parser.parsePathParam(context.request, route.pathParams[key]);
                }
                for (const key of ObjectUtilities.keys(route.queryParams)) {
                    (context.request.query[key] as unknown) = this.parser.parseQueryParam(context.request, route.queryParams[key]);
                }
                for (const key of ObjectUtilities.keys(route.headerParams)) {
                    (context.request.headers[key] as unknown) = this.parser.parseHeaderParam(context.request, route.headerParams[key]);
                }
                if (route.bodyMetadata) {
                    context.request.body = await this.parser.parseBody(context.request, route.bodyMetadata);
                }
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
                const result: unknown = await route.handler(context.request as HttpRequest<any, any, any, any>, context.response, next);
                await this.returnResult(context.response, result, next, []);
            }
            catch (error) {
                next(error);
            }
        };
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
            case HttpMethod.TRACE: {
                return { useInOpenApi: false };
            }
            case HttpMethod.POST:
            case HttpMethod.PUT:
            case HttpMethod.PATCH:
            case HttpMethod.DELETE:
            case HttpMethod.GET: {
                return {
                    responses: [],
                    tags: [],
                    useInOpenApi: true
                };
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, sonar/cognitive-complexity
    async registerController(controllerClass: Newable<unknown>): Promise<void> {
        const controllerData: ControllerData | undefined = MetadataUtilities.getControllerData(controllerClass);
        if (controllerData == undefined) {
            throw new MissingBaseRouteError(controllerClass);
        }
        const currentLatest: SemVerVersion | undefined = GlobalRegistry.getAppData('version');
        assert(currentLatest);

        const overlappingBaseRoute: RouteWithVersionData | undefined = this.allBaseRoutes.find(
            r => r.key === controllerData.baseRoute && this.versioningService.hasOverlappingVersions(
                r.versions,
                controllerData.versions,
                currentLatest
            )
        );
        if (overlappingBaseRoute) {
            const overlappingVersions: SupportedVersionsOptions = this.versioningService.findOverlappingVersions(
                overlappingBaseRoute.versions,
                controllerData.versions,
                currentLatest
            );
            if (overlappingVersions === 'all') {
                throw new InitRouterError([
                    `The base route "${controllerData.baseRoute}"`,
                    'has been defined on more than one controller.',
                    '(versions: \'all\' has been used)'
                ].join(' '));
            }
            throw new InitRouterError([
                `The base route "${controllerData.baseRoute}"`,
                `for the ${overlappingVersions.length > 1 ? 'versions' : 'version'} "${overlappingVersions.join(', ')}"`,
                'has been defined on more than one controller.'
            ].join(' '));
        }
        this.allBaseRoutes.push({ key: controllerData.baseRoute, versions: controllerData.versions });
        const routes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(controllerClass);

        for (const route of routes) {
            const finalRoute: string = controllerData.baseRoute === '/' ? route.route : `${controllerData.baseRoute}${route.route}`;
            const key: string = `${route.httpMethod.toUpperCase()} ${finalRoute}`;
            const versions: SupportedVersionsOptions = route.versions ?? controllerData.versions;

            const overlappingRoute: RouteWithVersionData | undefined = this.allFinalRoutes.find(
                r => r.key === key && this.versioningService.hasOverlappingVersions(r.versions, versions, currentLatest)
            );
            if (overlappingRoute) {
                const overlappingVersions: SupportedVersionsOptions = this.versioningService.findOverlappingVersions(
                    overlappingRoute.versions,
                    versions,
                    currentLatest
                );
                if (overlappingVersions === 'all') {
                    throw new InitRouterError([
                        `The route "${key}"`,
                        'has been defined more than once.',
                        '(versions: \'all\' has been used)'
                    ].join(' '));
                }

                throw new InitRouterError([
                    `The route "${key}"`,
                    `for the ${overlappingVersions.length > 1 ? 'versions' : 'version'} "${overlappingVersions.join(', ')}"`,
                    'has been defined more than once.'
                ].join(' '));
            }

            this.allFinalRoutes.push({ key, versions });

            const innerHandler: ControllerInnerHandler = await this.createControllerInnerHandler(controllerClass, route);
            // eslint-disable-next-line typescript/typedef
            const existing = this.pendingRouteGroups.get(key);
            if (existing) {
                existing.entries.push({ versions, innerHandler });
                continue;
            }

            this.pendingRouteGroups.set(key, {
                httpMethod: route.httpMethod,
                finalRoute,
                entries: [{ versions, innerHandler }]
            });
        }
    }

    private createDispatchHandler(
        // eslint-disable-next-line jsdoc/require-jsdoc
        entries: { versions: SupportedVersionsOptions, innerHandler: ControllerInnerHandler }[]
    ): RequestHandler {
        return (async (request: HttpRequest, res, next) => {
            // Express's own req.method is always uppercase ('GET'), but HttpRequest.method is typed as the
            // lowercase HttpMethod enum (the same casing expressRouter[httpMethod](...) requires for
            // registration) — normalize once here so the type is actually true for every handler/downstream
            // consumer of context.request.method, instead of every comparison site having to remember to do it.
            request.method = request.method.toLowerCase() as HttpMethod;
            Object.defineProperty(
                request,
                'params',
                {
                    value: { ...request.params },
                    writable: true,
                    configurable: true,
                    enumerable: true
                }
            );
            Object.defineProperty(
                request,
                'query',
                {
                    value: { ...request.query },
                    writable: true,
                    configurable: true,
                    enumerable: true
                }
            );
            Object.defineProperty(
                request,
                'headers',
                {
                    value: { ...request.headers },
                    writable: true,
                    configurable: true,
                    enumerable: true
                }
            );

            const context: HttpRequestContext = new HttpRequestContext(request, res, undefined, undefined);
            await AlsUtilities.runWithHttpRequestContext(context, async () => {
                try {
                    const version: Version = await context.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_VERSION);
                    // eslint-disable-next-line typescript/typedef
                    const match = entries.find(e => this.versioningService.matchesVersion(e.versions, version));
                    if (!match) {
                        throw new NotFoundError($ts`Could not find route "${request.url}" for version "${version.value}"`);
                    }
                    await match.innerHandler(context, next);
                }
                catch (error) {
                    next(error);
                }
            });
        }) as RequestHandler;
    }

    private async createControllerInnerHandler(
        controllerClass: Newable<unknown>,
        route: ControllerRouteConfiguration
    ): Promise<ControllerInnerHandler> {
        const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(controllerClass, route.controllerMethod);
        if (!responses.filter(r => r.implicit !== true).length) {
            await this.logger.warn(`No responses defined on route ${controllerClass.name}.${route.controllerMethod}`);
        }
        return async (context: HttpRequestContext, next: NextFunction) => {
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
                await this.returnResult(context.response, result, next, responses);
            }
            catch (error) {
                next(error);
            }
        };
    }

    private async returnResult(res: HttpResponse, result: unknown, next: NextFunction, responses: OpenApiResponse[]): Promise<void> {
        if (res.headersSent) {
            return;
        }
        if (result == undefined) {
            res.end();
            return;
        }

        this.validateResultType(responses, result);

        if (result instanceof FileResponse) {
            await this.returnFileResult(res, result, next);
            return;
        }

        if (result instanceof HtmlResponse) {
            this.returnHtmlResult(res, result, next);
            return;
        }

        res.json(JsonUtilities.parse(JsonUtilities.stringify(result)));
    }

    private async returnFileResult(res: HttpResponse, result: FileResponse, next: NextFunction): Promise<void> {
        res.setHeader(KnownHeader.CONTENT_TYPE, result.mimeType as MimeType);
        res.setHeader(KnownHeader.CONTENT_DISPOSITION, `attachment; filename="${encodeURIComponent(result.filename)}"`);
        if (result.size != undefined) {
            res.setHeader(KnownHeader.CONTENT_LENGTH, result.size);
        }
        if (result.csp !== false) {
            if (result.mimeType === MimeType.SVG) {
                await this.logger.warn('Useless CSP headers found on a file that is not of type svg');
            }
            const csp: CspOptions = result.csp === true ? inject(ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS) : result.csp;
            res.setHeader(KnownHeader.CONTENT_SECURITY_POLICY, buildCspHeaders(csp));
            if (csp.frameAncestors.length === 1) {
                const ancestor: CspSource = csp.frameAncestors[0];
                if (ancestor === '\'none\'') {
                    res.setHeader(KnownHeader.X_FRAME_OPTIONS, 'DENY');
                }
                else if (ancestor === '\'self\'') {
                    // eslint-disable-next-line cspell/spellchecker
                    res.setHeader(KnownHeader.X_FRAME_OPTIONS, 'SAMEORIGIN');
                }
            }
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
            res.removeHeader(KnownHeader.CONTENT_SECURITY_POLICY);
            next(err);
        }).pipe(res);
    }

    private returnHtmlResult(res: HttpResponse, result: HtmlResponse, next: NextFunction): void {
        res.setHeader(KnownHeader.CONTENT_TYPE, MimeType.HTML);
        if (result.csp !== false) {
            const csp: CspOptions = result.csp === true ? inject(ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS) : result.csp;
            res.setHeader(KnownHeader.CONTENT_SECURITY_POLICY, buildCspHeaders(csp));
            if (csp.frameAncestors.length === 1) {
                const ancestor: CspSource = csp.frameAncestors[0];
                if (ancestor === '\'none\'') {
                    res.setHeader(KnownHeader.X_FRAME_OPTIONS, 'DENY');
                }
                else if (ancestor === '\'self\'') {
                    // eslint-disable-next-line cspell/spellchecker
                    res.setHeader(KnownHeader.X_FRAME_OPTIONS, 'SAMEORIGIN');
                }
            }
        }
        // send html as string
        if (typeof result.data === 'string') {
            res.type('.html').send(result.data);
            return;
        }
        // send html as stream
        res.on('close', () => (result.data as Readable).destroy());
        result.data.on('error', err => {
            res.removeHeader(KnownHeader.CONTENT_TYPE);
            res.removeHeader(KnownHeader.CONTENT_SECURITY_POLICY);
            next(err);
        }).pipe(res);
    }

    private validateResultType(responses: OpenApiResponse[], result: {}): void {
        if (responses.some(r => r.type === 'json') // all non error responses are json responses
            && responses.filter(r => r.type !== 'error').length === responses.filter(r => r.type === 'json').length
            && ((result instanceof FileResponse) || (result instanceof HtmlResponse))) {
            throw new InitRouterError('Invalid return value, json cannot be FileResponse or HtmlResponse');
        }

        if (responses.some(r => r.type === 'file') // all non error responses are file responses
            && responses.filter(r => r.type !== 'error').length === responses.filter(r => r.type === 'file').length
            && !(result instanceof FileResponse)) {
            throw new InitRouterError('Invalid return value, needs to be a FileResponse');
        }

        if (responses.some(r => r.type === 'html') // all non error responses are html responses
            && responses.filter(r => r.type !== 'error').length === responses.filter(r => r.type === 'html').length
            && !(result instanceof HtmlResponse)) {
            throw new InitRouterError('Invalid return value, needs to be a HtmlResponse');
        }
    }
}