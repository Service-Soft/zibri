import { OpenApiExplorerTemplate, OpenApiExplorerVersion } from './explorer/open-api-explorer.model';
import { OpenApiSchemaUtilities } from './open-api-schema.utilities';
import { OpenApiServiceInterface } from './open-api-service.interface';
import { OpenApiDefinition, OpenApiTagObject, OpenApiSecuritySchemeObject, OpenApiPaths, OpenApiResponse, OpenApiOperation, OpenApiSecurityRequirementObject, OpenApiServerObject } from './open-api.model';
import { resolveResponseClass } from './resolve-response-class.function';
import { ZibriApplication } from '../application/application';
import { type AssetServiceInterface } from '../assets/asset-service.interface';
import { type AsyncApiServiceInterface } from '../async-api/async-api-service.interface';
import { AsyncApiDefinition } from '../async-api/async-api.model';
import { type AuthServiceInterface } from '../auth/auth-service.interface';
import { ResolvedAuthMetadata } from '../auth/models/resolved-auth-metadata.model';
import { type RouteAuthConfiguration } from '../auth/models/route-auth-configuration.model';
import { type RouteAuthServiceInterface } from '../auth/route-auth-service.interface';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { EntityMetadata } from '../entity/decorators/entity.decorator';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { InternalError } from '../error-handling/internal-error.model';
import { AfterAppInit } from '../global/after-app-init.interface';
import { OnAppStart } from '../global/on-app-start.interface';
import { RouteRegistry } from '../global/route-registry/route.registry';
import { HttpMethod, httpMethodKey } from '../http/http-method.enum';
import { $f } from '../localization/format.function';
import { $ts } from '../localization/translate.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { CspSource } from '../parsing/html/csp-options.model';
import { HtmlResponse } from '../parsing/html/html-response.model';
import { Route, ControllerRouteConfiguration } from '../routing/controller-route-configuration.model';
import { BodyMetadata } from '../routing/decorators/body-metadata.model';
import { ControllerData } from '../routing/decorators/controller.decorator';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata } from '../routing/decorators/param.decorator';
import { MissingBaseRouteError } from '../routing/missing-base-route.error';
import { type RouterInterface } from '../routing/router.interface';
import { TsxUtilities } from '../tsx/tsx.utilities';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { SemVerUtilities } from '../utilities/sem-ver.utilities';
import { SupportedVersionsOptions } from '../versioning/supported-versions-options.model';
import { Version, VersionFile } from '../versioning/version.model';
import { type VersioningServiceInterface } from '../versioning/versioning-service.interface';

/**
 * One version of the api, paired with the open api document describing it.
 */
type VersionWithDefinition = {
    /**
     * The version file the definition was built from.
     */
    version: VersionFile,
    /**
     * The open api document for that version.
     */
    definition: OpenApiDefinition
};

/**
 * Default open api service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class OpenApiService implements OpenApiServiceInterface, AfterAppInit, OnAppStart {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly openApiRoute: Route = '/explorer';

    /**
     * The document per version, built once the application is fully initialized.
     *
     * Not built in `afterAppInit` beside the routes below, because the two hooks it would need to sit
     * between run in the same phase and cannot both be first: it reads the versions VersioningService
     * loads in its own `afterAppInit`, and VersioningService snapshots the routes this one registers.
     * Building it on start resolves that - every init hook has run by then, whatever order they ran in.
     */
    private definitions: VersionWithDefinition[] = [];

    private get routeAuthService(): RouteAuthServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ROUTE_AUTH_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.ASSET_SERVICE)
        private readonly assetService: AssetServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        private readonly authService: AuthServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.ROUTER)
        private readonly router: RouterInterface,
        @Inject(ZIBRI_DI_TOKENS.VERSIONING_SERVICE)
        private readonly versioningService: VersioningServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.OPEN_API_AUTH)
        private readonly auth: RouteAuthConfiguration,
        @Inject(ZIBRI_DI_TOKENS.OPEN_API_EXPLORER_TEMPLATE)
        private readonly explorerTemplate: OpenApiExplorerTemplate | undefined,
        @Inject(ZIBRI_DI_TOKENS.VERSION_HEADER)
        private readonly versionHeader: string,
        @Inject(ZIBRI_DI_TOKENS.ASYNC_API_SERVICE)
        private readonly asyncApiService: AsyncApiServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.OPEN_API_SERVERS)
        private readonly servers: OpenApiServerObject[] | undefined
    ) { }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppStart(app: ZibriApplication): Promise<void> {
        this.definitions = await Promise.all(
            this.versioningService.getVersions().map(
                async v => ({ version: v, definition: await this.createOpenApiDefinition(app, v) })
            )
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    afterAppInit(app: ZibriApplication): void {
        this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/spec/:version`,
            versions: 'all',
            openApi: { useInOpenApi: false },
            auth: this.auth,
            pathParams: { version: { type: 'string' } },
            handler: (req) => {
                const versionValue: string = req.params['version'];
                const version: VersionWithDefinition | undefined = this.definitions.find(v => v.version.value === versionValue);
                if (!version) {
                    throw new NotFoundError($ts`Version "${versionValue}" not found`);
                }
                return version.definition;
            }
        });
        this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/asyncapi/:version`,
            versions: 'all',
            openApi: { useInOpenApi: false },
            auth: this.auth,
            pathParams: { version: { type: 'string' } },
            handler: (req) => {
                const versionValue: string = req.params['version'];
                const definition: AsyncApiDefinition | undefined = this.asyncApiService.findAsyncApiDefinition(versionValue);
                if (definition == undefined) {
                    throw new NotFoundError($ts`Version "${versionValue}" not found`);
                }
                return definition;
            }
        });

        const template: OpenApiExplorerTemplate | undefined = this.explorerTemplate;
        if (template == undefined) {
            this.logger.warn(
                `No ZIBRI_DI_TOKENS.OPEN_API_EXPLORER_TEMPLATE is provided, so there is no explorer at ${this.openApiRoute}.`
                + ` The documents are served at ${this.openApiRoute}/spec/<version>.`
            );
            return;
        }

        this.logger.info(`registers the OpenAPI Explorer at ${this.openApiRoute}`);

        this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: this.openApiRoute,
            versions: 'all',
            openApi: { useInOpenApi: false },
            auth: this.auth,
            handler: () => this.renderExplorer(app, template, undefined)
        });
        this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/:version`,
            versions: 'all',
            openApi: { useInOpenApi: false },
            auth: this.auth,
            pathParams: { version: { type: 'string' } },
            handler: (req) => this.renderExplorer(app, template, req.params['version'])
        });
    }

    /**
     * Renders the explorer on the document of one version.
     * @param app - The application.
     * @param template - The page.
     * @param versionValue - The version, or undefined for the latest.
     * @returns The page.
     * @throws A NotFoundError for a version the application does not have.
     */
    private renderExplorer(app: ZibriApplication, template: OpenApiExplorerTemplate, versionValue: string | undefined): HtmlResponse {
        const versions: OpenApiExplorerVersion[] = this.resolveExplorerVersions();
        const version: OpenApiExplorerVersion | undefined = versionValue == undefined
            ? versions[0]
            : versions.find(v => v.value === versionValue);
        const definition: OpenApiDefinition | undefined = this.definitions.find(v => v.version.value === version?.value)?.definition;
        const asyncApiDefinition: AsyncApiDefinition | undefined = version == undefined
            ? undefined
            : this.asyncApiService.findAsyncApiDefinition(version.value);
        if (version == undefined || definition == undefined || asyncApiDefinition == undefined) {
            throw new NotFoundError($ts`Version "${versionValue ?? ''}" not found`);
        }
        const html: string = TsxUtilities.renderPage(template, {
            appName: app.options.name,
            assetsRoute: this.assetService.assetsRoute,
            versions,
            version,
            definition,
            asyncApiDefinition,
            versionHeader: this.versionHeader
        });
        // an example of an image is shown from a data url, and a server the document names is one a request
        // can be tried against
        return HtmlResponse.fromString(html, {
            csp: { imgSrc: ['\'self\'', 'data:'], connectSrc: ['\'self\'', ...this.resolveServerOrigins(definition)] }
        });
    }

    /**
     * The versions the explorer offers, the latest first.
     * @returns The versions.
     */
    private resolveExplorerVersions(): OpenApiExplorerVersion[] {
        return this.versioningService
            .getVersions()
            .sort((a, b) => SemVerUtilities.compare(a.value, b.value) === 'bigger' ? -1 : 1)
            .map(v => ({
                value: v.value,
                name: v.endsAt == undefined
                    ? `${v.value} (latest)`
                    : `${v.value} (${$f.date(v.startsAt)} - ${$f.date(v.endsAt)})`,
                url: `${this.openApiRoute}/${v.value}`,
                documentUrl: `${this.openApiRoute}/spec/${v.value}`,
                asyncApiDocumentUrl: `${this.openApiRoute}/asyncapi/${v.value}`
            }));
    }

    /**
     * The origins of the servers a document names, which the page may send a request to.
     * @param definition - The document.
     * @returns The origins of the servers named with a full url. One named by a path is the application itself.
     */
    private resolveServerOrigins(definition: OpenApiDefinition): CspSource[] {
        const origins: CspSource[] = [];
        for (const server of definition.servers ?? []) {
            // a variable stands in the url as {name}, and the origin of a url with one in it cannot be known
            if (!URL.canParse(server.url) || server.url.includes('{')) {
                continue;
            }
            const url: URL = new URL(server.url);
            if (url.protocol === 'https:') {
                origins.push(`https://${url.host}`);
            }
            if (url.protocol === 'http:') {
                origins.push(`http://${url.host}`);
            }
        }
        return origins;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createOpenApiDefinition(app: ZibriApplication, version: Version): Promise<OpenApiDefinition> {
        const tags: OpenApiTagObject[] = app.options.controllers.map(cls => ({ name: cls.name }));
        const res: OpenApiDefinition = {
            openapi: '3.1.0',
            info: {
                // the name alone, unlike the explorer's page title: a gateway lists the api under it,
                // and a client generator names the client after it
                title: app.options.name,
                version: version.value
            },
            // relative, so a request goes to wherever the document was read from: an absolute baseUrl crosses
            // origins whenever the explorer is opened under another host, such as locally behind a proxy
            servers: this.servers ?? [
                {
                    url: '/',
                    // eslint-disable-next-line stylistic/max-len
                    description: $ts`This application. A request names the version in the version header, and logs in with the credentials of a security scheme.`
                }
            ],
            tags,
            components: {
                securitySchemes: this.resolveSecuritySchemes()
            },
            paths: await this.resolveOpenApiPaths(app, version)
        };
        return res;
    }

    private resolveSecuritySchemes(): Record<string, OpenApiSecuritySchemeObject> {
        const res: Record<string, OpenApiSecuritySchemeObject> = {};
        for (const strategy of this.authService.strategies.map(s => inject(s))) {
            res[strategy.name] = strategy.securityScheme;
        }
        return res;
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private async resolveOpenApiPaths(app: ZibriApplication, version: Version): Promise<OpenApiPaths> {
        const res: OpenApiPaths = {};

        for (const controllerClass of app.options.controllers.sort((a, b) => a.name.localeCompare(b.name))) {
            const controllerData: ControllerData | undefined = MetadataUtilities.getControllerData(controllerClass);
            if (!controllerData) {
                throw new MissingBaseRouteError(controllerClass);
            }

            const routes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(controllerClass);
            for (const route of routes) {
                const routeVersions: SupportedVersionsOptions = route.versions ?? controllerData.versions;
                if (!this.versioningService.matchesVersion(routeVersions, version)) {
                    continue;
                }

                const pathParams: Record<number, PathParamMetadata> = MetadataUtilities.getRoutePathParams(
                    controllerClass,
                    route.controllerMethod
                );

                const queryParams: Record<number, QueryParamMetadata> = MetadataUtilities.getRouteQueryParams(
                    controllerClass,
                    route.controllerMethod
                );

                const headerParams: Record<number, HeaderParamMetadata> = MetadataUtilities.getRouteHeaderParams(
                    controllerClass,
                    route.controllerMethod
                );

                const bodyMetadata: BodyMetadata | undefined = MetadataUtilities.getRouteBody(controllerClass, route.controllerMethod);
                // Ensure an entry exists
                const finalRoute: string = controllerData.baseRoute === '/' ? route.route : `${controllerData.baseRoute}${route.route}`;
                const fullPath: string = finalRoute.replaceAll(/:([^/]+)/g, '{$1}');
                res[fullPath] ??= {};

                const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(controllerClass, route.controllerMethod);

                const {
                    hasPermission: hasPermissionMetadata,
                    hasPlatformPermission: hasPlatformPermissionMetadata
                }: ResolvedAuthMetadata = RouteRegistry.get(
                    controllerClass,
                    route.controllerMethod
                ).auth.metadata;

                const operation: OpenApiOperation = {
                    description: this.describeScopes(responses),
                    responses: OpenApiSchemaUtilities.resolveResponses(responses),
                    tags: [controllerClass.name],
                    parameters: [
                        ...OpenApiSchemaUtilities.resolveParameters(pathParams, 'path'),
                        ...OpenApiSchemaUtilities.resolveParameters(queryParams, 'query'),
                        ...OpenApiSchemaUtilities.resolveParameters(headerParams, 'header')
                    ],
                    requestBody: OpenApiSchemaUtilities.resolveRequestBody(bodyMetadata),
                    security: await this.resolveOperationSecurity(controllerClass, route.controllerMethod),
                    ['x-permission']: hasPermissionMetadata?.permission,
                    ['x-platform-permission']: hasPlatformPermissionMetadata?.permission
                };
                res[fullPath][httpMethodKey(route.httpMethod)] = operation;
            }
        }

        for (const route of this.router.manuallyRegisteredRoutes.filter(r => r.openApi.useInOpenApi)) {
            if (!this.versioningService.matchesVersion(route.versions, version)) {
                continue;
            }
            // Ensure an entry exists
            const fullPath: string = `${route.route}`.replaceAll(/:([^/]+)/g, '{$1}');
            res[fullPath] ??= {};

            if (!route.openApi.useInOpenApi) {
                throw new InternalError(`Invalid open api configuration on route ${route.route}`);
            }

            const operation: OpenApiOperation = {
                responses: OpenApiSchemaUtilities.resolveResponses(route.openApi.responses),
                tags: route.openApi.tags,
                parameters: [
                    ...OpenApiSchemaUtilities.resolveParameters(route.pathParams, 'path'),
                    ...OpenApiSchemaUtilities.resolveParameters(route.queryParams, 'query'),
                    ...OpenApiSchemaUtilities.resolveParameters(route.headerParams, 'header')
                ],
                requestBody: OpenApiSchemaUtilities.resolveRequestBody(route.bodyMetadata),
                // a manually registered route had no posture to document, so this was a comment. Now
                // that it states one - or inherits `defaultAuth` by stating nothing - the spec says
                // the same thing about it that it says about a controller route
                security: this.resolveRouteSecurity(route.auth),
                ['x-permission']: route.auth?.hasPermission?.permission,
                ['x-platform-permission']: route.auth?.hasPlatformPermission?.permission
            };
            res[fullPath][httpMethodKey(route.httpMethod)] = operation;
        }

        return res;
    }

    /**
     * Says that the route only answers with part of what it returns, when its entity is scoped.
     *
     * Read off the entity the route declares it returns, because that is where the restriction is
     * declared - it is enforced by the repository rather than by anything on the route, so there is
     * nothing on the route itself to read it from. What the restriction *is* cannot be published: it
     * is a function of the request, so only its existence is knowable here. That is still worth
     * saying, because consumers read the spec instead of the code and a list quietly holding back
     * rows is not something to discover from traffic.
     * @param responses - What the route declares it can answer with.
     * @returns The description, or undefined when nothing it returns is scoped.
     */
    private describeScopes(responses: OpenApiResponse[]): string | undefined {
        const scoped: string[] = [];
        for (const response of responses) {
            const cls: Newable<unknown> | undefined = response.type === 'json' ? resolveResponseClass(response) : undefined;
            if (cls == undefined) {
                continue;
            }
            const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(cls as Newable<BaseEntity>);
            if (metadata?.scope?.restrictedTo != undefined && !scoped.includes(cls.name)) {
                scoped.push(cls.name);
            }
        }

        return !scoped.length
            ? undefined
            : `Restricted to what the caller is allowed to see. A ${scoped.join(' or ')} outside that is absent `
                + 'from a list and answered with a 404 when named directly.';
    }

    private async resolveOperationSecurity(
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ): Promise<OpenApiSecurityRequirementObject[] | undefined> {
        const res: OpenApiSecurityRequirementObject[] = [];

        // asked of the route auth service rather than derived from the decorators here: a route
        // requires a login under `defaultAuth: 'isLoggedIn'` without carrying a single one of them,
        // and reading the decorators alone documented every such route as public - the spec is what
        // consumers read instead of the code, so it said the opposite of what the route does.
        if (!await this.routeAuthService.requiresAuthentication(controllerClass, controllerMethod)) {
            return undefined;
        }

        for (const strategy of this.authService.strategies.map(s => inject(s))) {
            res.push({ [strategy.name]: [] });
        }
        return res;
    }

    /**
     * The security requirements of a manually registered route.
     * @param auth - What the route declared, if anything.
     * @returns One requirement per strategy, or undefined when the route answers anonymous callers.
     */
    private resolveRouteSecurity(auth: RouteAuthConfiguration | undefined): OpenApiSecurityRequirementObject[] | undefined {
        return !this.routeAuthService.requiresRouteAuthentication(auth)
            ? undefined
            : this.authService.strategies.map(s => ({ [inject(s).name]: [] }));
    }
}