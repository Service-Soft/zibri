import assert from 'node:assert';

import { NextFunction, Request, RequestHandler, Response, Router as ExpressRouter } from 'express';
import { match } from 'path-to-regexp';

import { ControllerRouteConfiguration } from './controller-route-configuration.model';
import { AcceptCrossSitePostsOptions } from './decorators/accept-cross-site-posts-options.model';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata, PathParamMetadataInput, QueryParamMetadataInput, HeaderParamMetadataInput } from './decorators/param.decorator';
import { MissingBaseRouteError } from './missing-base-route.error';
import { ParamMetadataUtilities } from './param-metadata.utilities';
import { resolveBodyMetadata } from './resolve-body-metadata.function';
import { ResponseWriterUtilities } from './response-writer.utilities';
import { OpenApiRouteConfiguration, RouteConfiguration, RouteConfigurationInput } from './route-configuration.model';
import { RouteParamMetadata } from './route-param-metadata.model';
import { RouteParamUtilities } from './route-param.utilities';
import { RouterInterface } from './router.interface';
import { ZibriApplication } from '../application/application';
import type { AuthServiceInterface } from '../auth/auth-service.interface';
import type { RouteAuthServiceInterface } from '../auth/route-auth-service.interface';
import { AlsUtilities } from '../context/als.utilities';
import { ControllerData } from './decorators/controller.decorator';
import { HttpRequestContext } from '../context/request/http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../context/request/request-context-token.model';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { getDiTokenName } from '../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../di/get-registered-providers-of-variant.function';
import { inject } from '../di/inject.function';
import { DiProvider } from '../di/models/di-provider.model';
import { DiVariants } from '../di/models/di-variant.model';
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
import { resolveResponseClass } from '../open-api/resolve-response-class.function';
import { type TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { validateRequestTenant } from '../tenancy/validate-request-tenant.function';
import { isNewable, Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { SemVerVersion } from '../utilities/sem-ver.utilities';
import { RouteWithVersionData } from '../versioning/route-with-version-data.model';
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

const DEFINED_MORE_THAN_ONCE: string = 'has been defined more than once.';

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
     * Holds the routes that accept requests with cookies from pages on other origins, so the check
     * refusing those, which runs before any route, matches a path exactly the way the routes do.
     */
    private readonly crossSitePostRouter: ExpressRouter = ExpressRouter();
    /**
     * What the route a request matched on the router above accepts, for as long as the request lives.
     */
    private readonly acceptedCrossSiteOrigins: WeakMap<Request, string[]> = new WeakMap();
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
        entries: { versions: SupportedVersionsOptions, innerHandler: ControllerInnerHandler }[],
        // eslint-disable-next-line jsdoc/require-jsdoc
        acceptCrossSitePosts: (AcceptCrossSitePostsOptions | undefined)[]
    }> = new Map();

    private get versioningService(): VersioningServiceInterface {
        return inject(ZIBRI_DI_TOKENS.VERSIONING_SERVICE);
    }

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    private get routeAuthService(): RouteAuthServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ROUTE_AUTH_SERVICE);
    }

    /**
     * What the application allows a handler that says nothing itself.
     *
     * Read per request rather than at registration, for the reason the versioning service above is:
     * a route can be registered before there is a container to ask.
     * @returns The application wide deadline.
     */
    private get handlerTimeout(): HandlerTimeout {
        return inject(ZIBRI_DI_TOKENS.HTTP_SERVER_LIMITS).handlerTimeoutInMs;
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
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
            this.registerCrossSitePosts(group.httpMethod, group.finalRoute, group.acceptCrossSitePosts);
        }
        this.initComplete = true;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveAcceptedCrossSiteOrigins(request: Request, response: Response): Promise<string[]> {
        return await new Promise<string[]>((resolve, reject) => {
            this.crossSitePostRouter(request, response, (error?: unknown) => {
                // `'router'` is how a matched route leaves the router once it has answered
                if (error != undefined && error !== 'router') {
                    reject(error);
                    return;
                }
                resolve(this.acceptedCrossSiteOrigins.get(request) ?? []);
            });
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    findMethods(path: string): HttpMethod[] {
        // matched the way express matches a request, whose router is built on the same library
        const matching: HttpMethod[] = [...this.pendingRouteGroups.values()]
            .filter(group => match(group.finalRoute)(path) !== false)
            .map(group => group.httpMethod);
        return Object.values(HttpMethod).filter(m => matching.includes(m));
    }

    /**
     * Puts a route that accepts requests with cookies from pages on other origins where the check
     * refusing those finds it.
     * @param httpMethod - The method of the route.
     * @param finalRoute - Its path.
     * @param declared - What each version of it declared, undefined for one that declared nothing.
     * @throws When it changes nothing, or its versions do not all declare the same.
     */
    private registerCrossSitePosts(
        httpMethod: HttpMethod,
        finalRoute: string,
        declared: (AcceptCrossSitePostsOptions | undefined)[]
    ): void {
        const [options] = declared;
        if (options == undefined && declared.every(d => d == undefined)) {
            return;
        }
        // the check runs before the route, where nothing says yet which version a request is for, so
        // every version of a route has to accept the same
        if (options == undefined || declared.some(d => d !== options)) {
            throw new InitRouterError(
                `Every version of the route "${httpMethod} ${finalRoute}" has to declare the same @AcceptCrossSitePosts.`
            );
        }
        if (httpMethod === HttpMethod.GET || httpMethod === HttpMethod.HEAD || httpMethod === HttpMethod.OPTIONS) {
            throw new InitRouterError(
                `@AcceptCrossSitePosts on "${httpMethod} ${finalRoute}", which changes nothing and is never refused.`
            );
        }
        this.crossSitePostRouter[httpMethodKey(httpMethod)](finalRoute, async (request, _, next) => {
            try {
                this.acceptedCrossSiteOrigins.set(request, await this.resolveOrigins(options, request.params));
            }
            catch (error) {
                next(error);
                return;
            }
            next('router');
        });
    }

    private async resolveOrigins(options: AcceptCrossSitePostsOptions, pathParams: Request['params']): Promise<string[]> {
        return typeof options.acceptedOrigins === 'function'
            // a wildcard segment arrives as its parts, which are one value of the path to the route
            ? await options.acceptedOrigins(Object.fromEntries(Object.entries(pathParams).map(
                ([name, value]): [string, string] => [name, Array.isArray(value) ? value.join('/') : value]
            )))
            : options.acceptedOrigins;
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
            case 'redirect': {
                // no body, so nothing a caller accepts can rule it out
                return undefined;
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
        return `${resolveResponseClass(response)?.name ?? 'json'}${response.isArray === true ? '[]' : ''} (${status})`;
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
        // while registering, where a controller route's declaration is refused as well
        this.routeAuthService.validateRouteAuth(input.auth, key);

        const overlappingRoute: RouteWithVersionData | undefined = this.allFinalRoutes.find(
            r => r.key === key && this.versioningService.hasOverlappingVersions(r.versions, versions, currentLatest)
        );
        if (overlappingRoute) {
            this.versioningService.validateNoOverlap(
                `The route "${key}"`,
                overlappingRoute.versions,
                versions,
                currentLatest,
                DEFINED_MORE_THAN_ONCE
            );
        }
        this.allFinalRoutes.push({ key, versions });

        const pathParams: Record<string, PathParamMetadata> = {};
        for (const [key, param] of ObjectUtilities.entries(input.pathParams ?? {})) {
            pathParams[key] = ParamMetadataUtilities.createPathParam(key, param);
        }
        const queryParams: Record<string, QueryParamMetadata> = {};
        for (const [key, param] of ObjectUtilities.entries(input.queryParams ?? {})) {
            queryParams[key] = ParamMetadataUtilities.createQueryParam(key, param);
        }
        const headerParams: Record<string, HeaderParamMetadata> = {};
        for (const [key, param] of ObjectUtilities.entries(input.headerParams ?? {})) {
            headerParams[key] = ParamMetadataUtilities.createHeaderParam(key, param);
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
        // a route registered here takes no decorators, so it accepts nothing from other origins
        if (existing) {
            existing.entries.push({ versions, innerHandler });
            existing.acceptCrossSitePosts.push(undefined);
        }
        else {
            this.pendingRouteGroups.set(key, {
                httpMethod: input.httpMethod,
                finalRoute: input.route,
                entries: [{ versions, innerHandler }],
                acceptCrossSitePosts: [undefined]
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
        // the declarations in the shape a controller route is served from, so that both kinds of
        // route are parsed and validated by the same code and a rule fixed for one holds for the
        // other. The body was put at position 0 when the route was
        // registered, so the parameters follow it
        const pathParams: PathParamMetadata[] = Object.values(route.pathParams);
        const queryParams: QueryParamMetadata[] = Object.values(route.queryParams);
        const headerParams: HeaderParamMetadata[] = Object.values(route.headerParams);
        const params: RouteParamMetadata = {
            pathParams: pathParams.map((metadata, i) => ({ index: 1 + i, metadata })),
            queryParams: queryParams.map((metadata, i) => ({ index: 1 + pathParams.length + i, metadata })),
            headerParams: headerParams.map((metadata, i) => ({ index: 1 + pathParams.length + queryParams.length + i, metadata })),
            body: route.bodyMetadata,
            currentUser: undefined,
            currentWebsocketConnection: undefined
        };
        const paramCount: number = 1 + pathParams.length + queryParams.length + headerParams.length;

        return async (context: HttpRequestContext, next: NextFunction) => {
            try {
                // before anything is parsed, exactly where the controller path checks: a route
                // registered as a configuration object is still a route, and what it costs to reach
                // must not depend on which of the two ways it was written down
                await this.authService.checkRouteAccess(route.auth, context);
                this.validateAcceptable(context.request, producible);
                // parsed onto the request, which is what the handler reads them from
                await RouteParamUtilities.resolveValues(params, paramCount, context);
                const result: unknown = await RequestDeadlineUtilities.resolveWithinDeadline(
                    context,
                    route.timeoutInMs ?? this.handlerTimeout,
                    // eslint-disable-next-line typescript/no-explicit-any
                    async () => await route.handler(context.request as HttpRequest<any, any, any, any>, context.response, next)
                );
                await this.writeCacheControl(context);
                await ResponseWriterUtilities.write(
                    context.request,
                    context.response,
                    result,
                    next,
                    [],
                    `${route.httpMethod} ${route.route}`
                );
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

    // eslint-disable-next-line jsdoc/require-jsdoc
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
            this.versioningService.validateNoOverlap(
                `The base route "${controllerData.baseRoute}"`,
                overlappingBaseRoute.versions,
                controllerData.versions,
                currentLatest,
                'has been defined on more than one controller.'
            );
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
                this.versioningService.validateNoOverlap(
                    `The route "${key}"`,
                    overlappingRoute.versions,
                    versions,
                    currentLatest,
                    DEFINED_MORE_THAN_ONCE
                );
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
            const acceptCrossSitePosts: AcceptCrossSitePostsOptions | undefined = MetadataUtilities
                .getRouteAcceptCrossSitePosts(controllerClass, route.controllerMethod);
            if (existing) {
                existing.entries.push({ versions, innerHandler });
                existing.acceptCrossSitePosts.push(acceptCrossSitePosts);
                continue;
            }

            this.pendingRouteGroups.set(key, {
                httpMethod: route.httpMethod,
                finalRoute,
                entries: [{ versions, innerHandler }],
                acceptCrossSitePosts: [acceptCrossSitePosts]
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
                    // around everything the route does, its access checks included: who may call it
                    // depends on the tenant the request is for
                    const named: string | undefined = await this.tenantService.resolveTenant(request);
                    validateRequestTenant(named);
                    // a credential bound to a tenant says it for a client that cannot, such as an
                    // identity provider calling with nothing but a url and a token
                    const tenantId: string | undefined = named ?? await this.authService.resolveCredentialTenant(context);
                    const dispatch: () => Promise<void> = async () => {
                        const version: Version = await context.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_VERSION);
                        // eslint-disable-next-line typescript/typedef
                        const match = entries.find(e => this.versioningService.matchesVersion(e.versions, version));
                        if (!match) {
                            throw new NotFoundError($ts`Could not find route "${request.url}" for version "${version.value}"`);
                        }
                        await match.innerHandler(context, next);
                    };
                    await (tenantId == undefined ? dispatch() : this.tenantService.runAs(tenantId, dispatch));
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
                const params: unknown[] = await RouteParamUtilities.resolveValues(
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
                await this.writeCacheControl(context);
                await ResponseWriterUtilities.write(
                    context.request,
                    context.response,
                    result,
                    next,
                    responses,
                    `${controllerClass.name}.${route.controllerMethod}`
                );
            }
            catch (error) {
                next(error);
            }
        };
    }

    /**
     * Keeps an answer to a logged in user out of every cache, unless the route said how to cache it.
     *
     * A request carrying `Authorization` is kept out of a shared cache by the cache itself, one logged
     * in by cookie is not: a cache between a browser and the application could keep one user's answer
     * and hand it to the next. Decided by whether this request found out who asked, which is what makes
     * an answer depend on it, so a public route stays cacheable.
     * @param context - The request.
     */
    private async writeCacheControl(context: HttpRequestContext): Promise<void> {
        const res: HttpResponse = context.response;
        if (res.headersSent || res.getHeader(KnownHeader.CACHE_CONTROL) != undefined) {
            return;
        }
        if (await this.authService.resolveIsCallerIdentified(context)) {
            res.setHeader(KnownHeader.CACHE_CONTROL, 'no-store');
        }
    }

}