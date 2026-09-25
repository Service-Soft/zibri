import assert from 'node:assert';
import { Readable } from 'stream';

import { NextFunction, RequestHandler, Router as ExpressRouter } from 'express';

import { ControllerRouteConfiguration } from './controller-route-configuration.model';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata, PathParamMetadataInput, QueryParamMetadataInput, HeaderParamMetadataInput } from './decorators/param.decorator';
import { MissingBaseRouteError } from './missing-base-route.error';
import { createHeaderParamMetadata, createPathParamMetadata, createQueryParamMetadata } from './param-metdata.helpers';
import { resolveBodyMetadata } from './resolve-body-metadata.function';
import { resolveRouteParams } from './resolve-route-params.function';
import { OpenApiRouteConfiguration, RouteConfiguration, RouteConfigurationInput } from './route-configuration.model';
import { RouterInterface } from './router.interface';
import { ZibriApplication } from '../application/application';
import type { AuthServiceInterface } from '../auth/auth-service.interface';
import { AlsUtilities } from '../context/als.utilities';
import { HttpRequestContext } from '../context/request/http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../context/request/request-context-token.model';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { getDiTokenName } from '../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../di/get-registered-providers-of-variant.function';
import { inject } from '../di/inject.function';
import { ControllerData } from './decorators/controller.decorator';
import { DiProvider } from '../di/models/di-provider.model';
import { DiVariants } from '../di/models/di-variant.model';
import { XmlWriterUtilities } from '../document/xml-writer.utilities';
import { MethodNotAllowedError } from '../error-handling/errors/method-not-allowed.error';
import { NotAcceptableError } from '../error-handling/errors/not-acceptable.error';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { InternalError } from '../error-handling/internal-error.model';
import { GlobalRegistry } from '../global/global-registry';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppStart } from '../global/on-app-start.interface';
import { RouteRegistry, RouteRegistryData } from '../global/route-registry/route.registry';
import { HandlerTimeout } from '../http/handler-timeout.type';
import { HttpMethod, httpMethodKey } from '../http/http-method.enum';
import { HttpRequest } from '../http/http-request.model';
import { HttpResponse } from '../http/http-response.model';
import { HttpStatus } from '../http/http-status.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MiddlewarePhase } from '../http/middleware-phase.enum';
import { MimeType } from '../http/mime-type.enum';
import { RequestDeadlineUtilities } from '../http/request-deadline.utilities';
import { $ts } from '../localization/translate.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { EmptyOpenApiResponse, JsonOpenApiResponse, OpenApiResponse } from '../open-api/open-api.model';
import { FileResponse, isFileResponse } from '../parsing/form-data/file-response.model';
import { buildCspHeaders, CspOptions, CspSource } from '../parsing/html/csp-options.model';
import { HtmlResponse, isHtmlResponse } from '../parsing/html/html-response.model';
import type { ParserInterface } from '../parsing/parser.interface';
import { isNewable, Newable } from '../types/newable.type';
import { JsonUtilities } from '../utilities/json.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import type { ValidationServiceInterface } from '../validation/validation-service.interface';
import { RouteWithVersionData } from '../versioning/route-with-version-data.model';
import { SemVerVersion } from '../versioning/sem-ver.utilities';
import { SupportedVersionsOptions } from '../versioning/supported-versions-options.model';
import { Version } from '../versioning/version.model';
import { type VersioningServiceInterface } from '../versioning/versioning-service.interface';
import { BodyMetadata, DeclaredBodyInput } from './decorators/body-metadata.model';

/**
 * A declared response whose format is negotiated.
 */
type NegotiatedOpenApiResponse = JsonOpenApiResponse | EmptyOpenApiResponse;

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
    /**
     * Answers for a path that exists under some method, when none of them was the one asked for.
     */
    private readonly methodRouter: ExpressRouter = ExpressRouter();
    /**
     * The paths that already have an entry on the router above, so each one gets exactly one.
     */
    private readonly routesAnsweringAllow: Set<string> = new Set();
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

    /**
     * What the application allows a handler that says nothing itself.
     *
     * Read per request rather than at registration, for the reason the versioning service above is:
     * a route can be registered before there is a container to ask.
     * @returns The application wide deadline.
     */
    private get handlerTimeout(): HandlerTimeout {
        return inject(ZIBRI_DI_TOKENS.HTTP_SERVER_TIMEOUTS).handlerInMs;
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
    onAppInit(app: ZibriApplication): void {
        this.logger.info(`registers ${app.options.controllers.length} controllers:`);
        for (const controller of app.options.controllers) {
            const routes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(controller);
            this.logger.info(`  - ${controller.name} (${routes.length} routes)`);
            this.registerController(controller);
        }
        this.validateNoOrphanedControllers(app.options.controllers);

        for (const group of this.pendingRouteGroups.values()) {
            const dispatchHandler: RequestHandler = this.createDispatchHandler(group.entries);
            this.logger.debug(`- mounting ${group.httpMethod} ${group.finalRoute}`);
            this.expressRouter[httpMethodKey(group.httpMethod)](group.finalRoute, dispatchHandler);
        }
        for (const group of this.pendingRouteGroups.values()) {
            this.answerAllowFor(group.finalRoute);
        }
        this.initComplete = true;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppStart(app: ZibriApplication): void {
        app.use(this.expressRouter, MiddlewarePhase.ROUTING);
        // after the routes themselves, so it is only reached by a request none of them answered. It
        // is a router of its own rather than more layers on the one above, because a layer matching
        // every method on a known path would shadow a route registered on that path later
        app.use(this.methodRouter, MiddlewarePhase.ROUTING);
    }

    /**
     * The media types a route can answer with, or nothing when it never said.
     *
     * Read off what the route declared for its documentation, because that is already the one place
     * a route states what it produces - deriving it a second way would let the two disagree, and the
     * one a client reads is the documented one.
     *
     * Error responses are left out. What the error handler answers with is negotiated separately and
     * is not a representation of the resource, so counting them would make every route that
     * documents a 404 acceptable to a caller that cannot read a single one of its successful answers.
     *
     * So are the ones the framework added itself, which is the difference between a route that
     * answers json and one that never said: `@RateLimited({ reserveIfUnavailable: true })` documents
     * the reservation it can answer with, and a route carrying only that has still declared nothing
     * about what it produces. Refusing a caller on the strength of it would let a rate limit decide
     * content negotiation. It is the same test the startup warning about undeclared responses makes.
     * @param responses - What the route declared.
     * @returns The types, or undefined when nothing here constrains the answer.
     */
    private producibleMediaTypes(responses: OpenApiResponse[]): MimeType[] | undefined {
        const types: Set<MimeType> = new Set();
        for (const response of responses.filter(r => r.implicit !== true)) {
            const produced: MimeType[] | undefined = this.resolveMediaTypes(response);
            if (produced == undefined) {
                return undefined;
            }
            for (const mimeType of produced) {
                types.add(mimeType);
            }
        }
        return types.size ? [...types] : undefined;
    }

    /**
     * The media types one declared response can be answered with.
     * @param response - The declared response.
     * @returns The types, or undefined when the response can be anything.
     */
    private resolveMediaTypes(response: OpenApiResponse): MimeType[] | undefined {
        switch (response.type) {
            case 'error': {
                return [];
            }
            case 'json':
            case 'empty': {
                return this.resolveNegotiatedMediaTypes(response);
            }
            case 'html': {
                return [MimeType.HTML];
            }
            case 'file': {
                // a route that will answer with whatever the file turns out to be cannot refuse
                // anything in advance, and neither can one that did not say
                if (response.mimeType == undefined || response.mimeType === 'all') {
                    return undefined;
                }
                return Array.isArray(response.mimeType) ? response.mimeType : [response.mimeType];
            }
        }
    }

    /**
     * The formats a json or an empty response can be written in.
     * @param response - The declared response.
     * @returns The formats.
     */
    private resolveNegotiatedMediaTypes(response: NegotiatedOpenApiResponse): MimeType[] {
        if (response.mimeTypes != undefined) {
            return response.mimeTypes;
        }
        // an empty response has no body in any format, so on its own it refuses nobody who reads
        // either. Next to a response written in json alone it has to say so, which the check that a
        // route's responses agree makes it do
        return response.type === 'empty' ? [MimeType.JSON, MimeType.XML] : [MimeType.JSON];
    }

    /**
     * Refuses a route whose json and empty responses are written in different formats.
     *
     * Whether a request is refused with a 406 is decided before the handler runs, from what the route
     * declared, and that is exact only while every outcome can be written in the same formats. A route
     * answering an object in json and xml but a list in json alone lets a client reading only xml
     * through, and then hands it json. Deciding once the handler has returned would be exact, but it
     * refuses a request whose work is already done: a row was created, the caller is told it failed,
     * and it creates it again.
     * @param responses - What the route declared.
     * @param routeName - The route, for the error.
     * @throws When two of them differ.
     */
    private validateSameMediaTypes(responses: OpenApiResponse[], routeName: string): void {
        const declared: NegotiatedOpenApiResponse[] = responses.filter(
            (r): r is NegotiatedOpenApiResponse => (r.type === 'json' || r.type === 'empty') && r.implicit !== true
        );
        const formats: string[] = declared.map(r => [...this.resolveNegotiatedMediaTypes(r)].sort().join(', '));
        if (new Set(formats).size <= 1) {
            return;
        }
        throw new InitRouterError([
            `The responses of ${routeName} are written in different formats:`,
            ...declared.map((r, i) => `  - ${this.describeNegotiatedResponse(r)}: ${formats[i]}`),
            'Give each of them the same mimeTypes. An empty response answers json and xml unless it names its own,',
            'eg. `@Response.empty({ mimeTypes: [MimeType.XML] })` next to responses written in xml alone.'
        ]);
    }

    private describeNegotiatedResponse(response: NegotiatedOpenApiResponse): string {
        const status: string = `${response.status ?? 'default status'}`;
        if (response.type === 'empty') {
            return `empty (${status})`;
        }
        return `${response.cls?.name ?? 'json'}${response.isArray === true ? '[]' : ''} (${status})`;
    }

    /**
     * Refuses a request whose caller can read none of what this route answers with.
     *
     * Before the handler runs rather than before the response is written: the work a route does is
     * usually the point of calling it, and a request that was always going to be refused should not
     * have created a row first. It costs a route that produces a type it never declared - which is
     * the same declaration a generated client is written against, so the two are wrong together.
     * @param request - The request to check.
     * @param producible - What the route said it produces.
     * @throws When the caller accepts none of them.
     */
    private validateAcceptable(request: HttpRequest, producible: MimeType[] | undefined): void {
        if (producible == undefined || request.accepts(producible) !== false) {
            return;
        }
        throw new NotAcceptableError(request.headers[KnownHeader.ACCEPT] ?? '', producible);
    }

    /**
     * Makes a path answer for the methods it does not have, rather than claiming it does not exist.
     *
     * Two layers, because the two answers belong in different places. The `OPTIONS` one goes on the
     * router holding the routes: express answers an `OPTIONS` for a path some layer matched by
     * generating an `Allow` of its own, and it does that before the request could reach anything
     * mounted after - so the only way to be the one deciding is to be a route. The 405 goes on the
     * router after it, where it is reached only once every real route has declined.
     * @param finalRoute - The path to answer for.
     */
    private answerAllowFor(finalRoute: string): void {
        if (this.routesAnsweringAllow.has(finalRoute)) {
            return;
        }
        this.routesAnsweringAllow.add(finalRoute);

        this.expressRouter.options(finalRoute, (req, res, next) => {
            // a route of the application's own, registered after this layer was mounted. It is behind
            // this one on the same router, so declining is what lets it answer
            if (this.pendingRouteGroups.has(`${HttpMethod.OPTIONS} ${finalRoute}`)) {
                next();
                return;
            }
            res.setHeader(KnownHeader.ALLOW, this.methodsFor(finalRoute).join(', '));
            res.status(HttpStatus.NO_CONTENT).end();
        });

        this.methodRouter.all(finalRoute, (req, _res, next) => {
            const allowedMethods: HttpMethod[] = this.methodsFor(finalRoute);
            // a method the path does have, which reaches this only because the handler for it
            // declined - a manually registered route calling `next()` to say it is not the one after
            // all. That is a request nothing answered rather than one asked for with the wrong verb
            if (allowedMethods.some(m => m === req.method)) {
                next();
                return;
            }
            next(new MethodNotAllowedError(req.method, allowedMethods));
        });
    }

    /**
     * Every method this path answers, read when it is asked for rather than when it was mounted.
     *
     * Routes can still arrive after the application is listening, and an `Allow` computed once would
     * go on naming what was true at boot.
     * @param finalRoute - The path to look up.
     * @returns The methods, in the order the protocol spells them.
     */
    private methodsFor(finalRoute: string): HttpMethod[] {
        const declared: Set<HttpMethod> = new Set(
            [...this.pendingRouteGroups.values()].filter(g => g.finalRoute === finalRoute).map(g => g.httpMethod)
        );
        // both are answered without having been declared: express serves a HEAD from the GET handler
        // and drops the body, and the layer above answers OPTIONS for every path that exists
        if (declared.has(HttpMethod.GET)) {
            declared.add(HttpMethod.HEAD);
        }
        declared.add(HttpMethod.OPTIONS);
        return Object.values(HttpMethod).filter(m => declared.has(m));
    }

    private validateNoOrphanedControllers(controllers: Newable<unknown>[]): void {
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
    registerRoute<
        BodyMetaInputObject extends DeclaredBodyInput,
        PathMetaInputObject extends Record<string, PathParamMetadataInput>,
        QueryMetaInputObject extends Record<string, QueryParamMetadataInput>,
        HeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>
    >(
        input: RouteConfigurationInput<BodyMetaInputObject, PathMetaInputObject, QueryMetaInputObject, HeaderMetaInputObject>
    ): void {
        const key: string = `${input.httpMethod} ${input.route}`;
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
        for (const [key, param] of ObjectUtilities.entries(input.pathParams ?? {})) {
            pathParams[key] = createPathParamMetadata(key, param);
        }
        const queryParams: Record<string, QueryParamMetadata> = {};
        for (const [key, param] of ObjectUtilities.entries(input.queryParams ?? {})) {
            queryParams[key] = createQueryParamMetadata(key, param);
        }
        const headerParams: Record<string, HeaderParamMetadata> = {};
        for (const [key, param] of ObjectUtilities.entries(input.headerParams ?? {})) {
            headerParams[key] = createHeaderParamMetadata(key, param);
        }

        // eslint-disable-next-line typescript/no-explicit-any
        const route: RouteConfiguration<any, any, any, any> = {
            versions: ['^latest'],
            ...input,
            // restated rather than left to the spread: the input has them optional and the route has
            // them required, so a route that said nothing would otherwise not carry the field at all
            auth: input.auth,
            timeoutInMs: input.timeoutInMs,
            openApi: this.createOpenApiRouteConfiguration(input.openApi, input.httpMethod),
            bodyMetadata: input.bodyMetadata
                ? resolveBodyMetadata(input.bodyMetadata, 0)
                : undefined,
            pathParams,
            queryParams,
            headerParams
        };

        this.logger.debug(`- mounting ${key}`);
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
            this.expressRouter[httpMethodKey(input.httpMethod)](input.route, this.createDispatchHandler(group.entries));
            this.answerAllowFor(input.route);
        }
    }

    private createManualRouteInnerHandler<
        BodyMetaObject extends BodyMetadata,
        PathMetaObject extends Record<string, PathParamMetadata>,
        QueryMetaObject extends Record<string, QueryParamMetadata>,
        HeaderMetaObject extends Record<string, HeaderParamMetadata>
    >(route: RouteConfiguration<BodyMetaObject, PathMetaObject, QueryMetaObject, HeaderMetaObject>): ControllerInnerHandler {
        const responses: OpenApiResponse[] = route.openApi.useInOpenApi ? route.openApi.responses : [];
        this.validateSameMediaTypes(responses, `${route.httpMethod} ${route.route}`);
        const producible: MimeType[] | undefined = this.producibleMediaTypes(responses);

        return async (context: HttpRequestContext, next: NextFunction) => {
            try {
                // before anything is parsed, exactly where the controller path checks: a route
                // registered as a configuration object is still a route, and what it costs to reach
                // must not depend on which of the two ways it was written down
                await this.authService.checkRouteAccess(route.auth, context);
                this.validateAcceptable(context.request, producible);
                for (const [key, param] of ObjectUtilities.entries(route.pathParams)) {
                    (context.request.params[key] as unknown) = this.parser.parsePathParam(context.request, param);
                }
                for (const [key, param] of ObjectUtilities.entries(route.queryParams)) {
                    (context.request.query[key] as unknown) = this.parser.parseQueryParam(context.request, param);
                }
                for (const [key, param] of ObjectUtilities.entries(route.headerParams)) {
                    (context.request.headers[key] as unknown) = this.parser.parseHeaderParam(context.request, param);
                }
                if (route.bodyMetadata) {
                    context.request.body = await this.parser.parseBody(context.request, route.bodyMetadata);
                }
                await Promise.all([
                    ...ObjectUtilities.entries(route.pathParams).map(async ([key, param]) => {
                        await this.validationService.validatePathParam(context.request.params[key], param);
                    }),
                    ...ObjectUtilities.entries(route.queryParams).map(async ([key, param]) => {
                        await this.validationService.validateQueryParam(context.request.query[key], param);
                    }),
                    ...ObjectUtilities.entries(route.headerParams).map(async ([key, param]) => {
                        await this.validationService.validateHeaderParam(context.request.headers[key], param);
                    }),
                    ...route.bodyMetadata ? [this.validationService.validateBody(context.request.body, route.bodyMetadata)] : []
                ]);
                const result: unknown = await RequestDeadlineUtilities.resolveWithinDeadline(
                    context,
                    route.timeoutInMs ?? this.handlerTimeout,
                    // eslint-disable-next-line typescript/no-explicit-any
                    async () => await route.handler(context.request as HttpRequest<any, any, any, any>, context.response, next)
                );
                await this.returnResult(context.request, context.response, result, next, []);
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
    registerController(controllerClass: Newable<unknown>): void {
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
            const key: string = `${route.httpMethod} ${finalRoute}`;
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

            const innerHandler: ControllerInnerHandler = this.createControllerInnerHandler(
                controllerClass,
                route,
                // a route that says nothing takes what its controller says, exactly as it does for
                // the versions it supports. `??` rather than a truthiness check, because a route
                // declaring `'none'` has said something
                route.timeoutInMs ?? controllerData.timeoutInMs
            );
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

            const context: HttpRequestContext = new HttpRequestContext(request, res);
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

    private createControllerInnerHandler(
        controllerClass: Newable<unknown>,
        route: ControllerRouteConfiguration,
        timeoutInMs: HandlerTimeout | undefined
    ): ControllerInnerHandler {
        const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(controllerClass, route.controllerMethod);
        if (!responses.filter(r => r.implicit !== true).length) {
            this.logger.warn(`No responses defined on route ${controllerClass.name}.${route.controllerMethod}`);
        }
        this.validateSameMediaTypes(responses, `${controllerClass.name}.${route.controllerMethod}`);
        const producible: MimeType[] | undefined = this.producibleMediaTypes(responses);
        // what the route declared, resolved here rather than on every request that reaches it. The
        // decorators ran at module load, so there is nothing later to learn - and resolving what they
        // said is not free of side effects: it is where a declaration nothing can satisfy is refused,
        // which belongs to booting rather than to whoever calls the route first.
        const routeData: RouteRegistryData = RouteRegistry.register(controllerClass, route.controllerMethod);

        return async (context: HttpRequestContext, next: NextFunction) => {
            try {
                // before the first check runs, because every question the context can answer about
                // who this is depends on what the route asked for
                context.matchedBy(controllerClass, route.controllerMethod);
                await this.authService.checkAccess(controllerClass, route.controllerMethod, context);
                // after the access check, so that what a caller may know about a route still depends
                // on being allowed to call it: a 406 says the route is there and answers something
                this.validateAcceptable(context.request, producible);
                const controller: unknown = inject(controllerClass);
                const params: unknown[] = await resolveRouteParams(
                    routeData.params,
                    // eslint-disable-next-line typescript/no-unsafe-member-access, typescript/no-explicit-any
                    ((controller as any)[route.controllerMethod] as Function).length,
                    context
                );
                const result: unknown = await RequestDeadlineUtilities.resolveWithinDeadline(
                    context,
                    timeoutInMs ?? this.handlerTimeout,
                    // eslint-disable-next-line typescript/no-unsafe-call, typescript/no-explicit-any, typescript/no-unsafe-member-access
                    async (): Promise<unknown> => await ((controller as any)[route.controllerMethod] as Function)(...params)
                );
                await this.returnResult(context.request, context.response, result, next, responses);
            }
            catch (error) {
                next(error);
            }
        };
    }

    private async returnResult(
        req: HttpRequest,
        res: HttpResponse,
        result: unknown,
        next: NextFunction,
        responses: OpenApiResponse[]
    ): Promise<void> {
        if (res.headersSent) {
            return;
        }

        const status: HttpStatus | undefined = this.resolveStatus(responses, result);
        if (status != undefined) {
            res.status(status);
        }

        if (result == undefined) {
            res.end();
            return;
        }

        this.validateResultType(responses, result);

        if (isFileResponse(result)) {
            this.returnFileResult(res, result, next);
            return;
        }

        if (isHtmlResponse(result)) {
            this.returnHtmlResult(res, result, next);
            return;
        }

        const cls: Newable<unknown> | undefined = this.resolveXmlClass(req, res, responses, result);
        if (cls != undefined) {
            res.type(MimeType.XML).send(await XmlWriterUtilities.write(cls, result));
            return;
        }

        // serialized once and written. res.json would serialize whatever it is handed, so handing it
        // a parsed copy of a string the framework had already produced meant three passes over the
        // whole graph - and the middle one allocated a second copy of it to throw away.
        res.type(MimeType.JSON).send(JsonUtilities.stringify(result));
    }

    /**
     * The model a result is written as xml with, when the request is answered with xml.
     *
     * Decided by the declaration that answers for the result, the same one its status comes from, and by
     * the formats that declaration names: the request's `Accept` picks among them, and the first is taken
     * when it accepts several or names none.
     * @param req - The request, for what it accepts.
     * @param res - The response, which is told that it varies by what the request accepts.
     * @param responses - What the route declares it can answer with.
     * @param result - What the handler returned.
     * @returns The model, or undefined when the result is written as json.
     */
    private resolveXmlClass(
        req: HttpRequest,
        res: HttpResponse,
        responses: OpenApiResponse[],
        result: unknown
    ): Newable<unknown> | undefined {
        const candidates: OpenApiResponse[] = responses.filter(r => this.canAnswerWith(r, result));
        const response: OpenApiResponse | undefined = candidates.length === 1 ? candidates[0] : undefined;
        if (response?.type !== 'json' || response.mimeTypes == undefined || response.cls == undefined) {
            return undefined;
        }
        if (response.mimeTypes.length > 1) {
            // a cache in front of this has to keep the formats apart, or one client gets the other's
            res.vary(KnownHeader.ACCEPT);
        }
        // the 406 before the handler ran made sure the request accepts one of what the route declares
        const accepted: string | false = req.accepts(response.mimeTypes);
        const mimeType: MimeType | undefined = accepted === false ? response.mimeTypes[0] : response.mimeTypes.find(m => m === accepted);
        return mimeType === MimeType.XML ? response.cls : undefined;
    }

    private returnFileResult(res: HttpResponse, result: FileResponse, next: NextFunction): void {
        res.setHeader(KnownHeader.CONTENT_TYPE, result.mimeType as MimeType);
        res.setHeader(KnownHeader.CONTENT_DISPOSITION, `attachment; filename="${encodeURIComponent(result.filename)}"`);
        if (result.size != undefined) {
            res.setHeader(KnownHeader.CONTENT_LENGTH, result.size);
        }
        if (result.csp !== false) {
            if (result.mimeType === MimeType.SVG) {
                this.logger.warn('Useless CSP headers found on a file that is not of type svg');
            }
            const csp: CspOptions = result.csp === true ? inject(ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS) : result.csp;
            res.setHeader(KnownHeader.CONTENT_SECURITY_POLICY, buildCspHeaders(csp));
            const ancestor: CspSource | undefined = csp.frameAncestors.length === 1 ? csp.frameAncestors[0] : undefined;
            if (ancestor != undefined) {
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
        result.data.on('error', err => this.failStream(res, next, err, [
            KnownHeader.CONTENT_TYPE,
            KnownHeader.CONTENT_LENGTH,
            KnownHeader.CONTENT_DISPOSITION,
            KnownHeader.CONTENT_SECURITY_POLICY
        ])).pipe(res);
    }

    /**
     * Ends a response whose stream failed part way through.
     *
     * Two different situations wearing one shape, and only one of them can still be answered. While
     * the head is unsent the response can still become an error page, so the headers set for the body
     * that is not coming are taken back off and the error goes to the handler.
     *
     * Once the head is flushed neither is possible. `removeHeader` throws `ERR_HTTP_HEADERS_SENT`
     * there, and it threw from inside an `'error'` listener - outside every `try` around the handler
     * - so `next` was never reached, nothing ended the response, and the caller held an open socket
     * until its own timeout. With the process level handler rethrowing, one failed download ended the
     * process. Any file larger than a single chunk is in this case.
     *
     * What is left once the status is on the wire is to stop: destroying the response closes the
     * connection, which is how a caller learns that a body it was promised is not arriving. Ending it
     * cleanly would present a truncated body as a complete one.
     * @param res - The response being written.
     * @param next - The error handler, for as long as it can still produce a status.
     * @param error - What the stream failed with.
     * @param headers - The headers this response set for the body it is no longer sending.
     */
    private failStream(res: HttpResponse, next: NextFunction, error: Error, headers: KnownHeader[]): void {
        if (res.headersSent) {
            // the only record there will be: the error handler cannot run, so nothing else reports
            // that this download failed
            this.logger.error(new InternalError('A response stream failed after its headers were sent.', { cause: error }));
            res.destroy();
            return;
        }
        for (const header of headers) {
            res.removeHeader(header);
        }
        next(error);
    }

    private returnHtmlResult(res: HttpResponse, result: HtmlResponse, next: NextFunction): void {
        res.setHeader(KnownHeader.CONTENT_TYPE, MimeType.HTML);
        if (result.csp !== false) {
            const csp: CspOptions = result.csp === true ? inject(ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS) : result.csp;
            res.setHeader(KnownHeader.CONTENT_SECURITY_POLICY, buildCspHeaders(csp));
            const ancestor: CspSource | undefined = csp.frameAncestors.length === 1 ? csp.frameAncestors[0] : undefined;
            if (ancestor != undefined) {
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
        result.data.on('error', err => this.failStream(res, next, err, [
            KnownHeader.CONTENT_TYPE,
            KnownHeader.CONTENT_SECURITY_POLICY
        ])).pipe(res);
    }

    /**
     * The status a successful result is answered with.
     *
     * A declared status used to be documentation only: a route saying it answers 201 published that
     * and then answered 200 anyway.
     * @param responses - What the route declares it can answer with.
     * @param result - What the handler returned.
     * @returns The status to set, or undefined to leave express's default alone.
     */
    private resolveStatus(responses: OpenApiResponse[], result: unknown): HttpStatus | undefined {
        // an instance of a declared class picks that declaration outright, which is what tells the
        // two successful outcomes of a rate limited route apart - the reserved one is a class of its
        // own, while a normal handler usually returns a plain object matching nothing exactly
        const exact: OpenApiResponse[] = responses.filter(
            r => r.type === 'json' && r.isArray !== true && r.cls != undefined && result instanceof r.cls
        );
        const exactMatch: OpenApiResponse | undefined = exact.length === 1 ? exact[0] : undefined;
        if (exactMatch != undefined) {
            return exactMatch.status;
        }

        const candidates: OpenApiResponse[] = responses.filter(r => this.canAnswerWith(r, result));
        // one declaration that can answer for this value decides. Several cannot be told apart from
        // the value alone, and picking between them would make the status depend on the order the
        // decorators happen to be written in.
        const candidate: OpenApiResponse | undefined = candidates.length === 1 ? candidates[0] : undefined;
        const status: HttpStatus | undefined = candidate?.status;

        if (result == undefined) {
            // nothing to send, and 204 says so. A 200 with an empty body leaves every client to find
            // that out by trying to parse one.
            return status ?? HttpStatus.NO_CONTENT;
        }
        return status;
    }

    /**
     * Whether the given declaration could be describing this value.
     * @param response - The declared response.
     * @param result - What the handler returned.
     * @returns True when the value has the shape the declaration describes.
     */
    private canAnswerWith(response: OpenApiResponse, result: unknown): boolean {
        switch (response.type) {
            case 'error': {
                // never a successful result. What the error handler answers with is its own business
                return false;
            }
            case 'file': {
                return isFileResponse(result);
            }
            case 'html': {
                return isHtmlResponse(result);
            }
            case 'empty': {
                // describes nothing being returned, and only that
                return result == undefined;
            }
            case 'json': {
                if (result == undefined) {
                    return false;
                }
                return response.isArray === true ? Array.isArray(result) : !Array.isArray(result);
            }
        }
    }

    private validateResultType(responses: OpenApiResponse[], result: {}): void {
        // what a returned value is checked against: an empty response never describes one, and neither
        // does an error response
        const bodies: OpenApiResponse[] = responses.filter(r => r.type !== 'error' && r.type !== 'empty');
        if (bodies.some(r => r.type === 'json') // all responses with a body are json responses
            && bodies.length === bodies.filter(r => r.type === 'json').length
            && (isFileResponse(result) || isHtmlResponse(result))) {
            throw new InitRouterError('Invalid return value, json cannot be FileResponse or HtmlResponse');
        }

        if (bodies.some(r => r.type === 'file') // all responses with a body are file responses
            && bodies.length === bodies.filter(r => r.type === 'file').length
            && !isFileResponse(result)) {
            throw new InitRouterError('Invalid return value, needs to be a FileResponse');
        }

        if (bodies.some(r => r.type === 'html') // all responses with a body are html responses
            && bodies.length === bodies.filter(r => r.type === 'html').length
            && !isHtmlResponse(result)) {
            throw new InitRouterError('Invalid return value, needs to be a HtmlResponse');
        }
    }
}