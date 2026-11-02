import { OpenApiSchemaUtilities } from './open-api-schema.utilities';
import { OpenApiServiceInterface } from './open-api-service.interface';
import { OpenApiDefinition, OpenApiTagObject, OpenApiSecuritySchemeObject, OpenApiPaths, OpenApiResponse, OpenApiOperation, OpenApiSecurityRequirementObject } from './open-api.model';
import { resolveResponseClass } from './resolve-response-class.function';
import { ZibriApplication } from '../application/application';
import { type AssetServiceInterface } from '../assets/asset-service.interface';
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
import { FileResponse } from '../parsing/form-data/file-response.model';
import { HtmlResponse } from '../parsing/html/html-response.model';
import { HtmlUtilities } from '../parsing/html/html.utilities';
import { Route, ControllerRouteConfiguration } from '../routing/controller-route-configuration.model';
import { BodyMetadata } from '../routing/decorators/body-metadata.model';
import { ControllerData } from '../routing/decorators/controller.decorator';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata } from '../routing/decorators/param.decorator';
import { MissingBaseRouteError } from '../routing/missing-base-route.error';
import { type RouterInterface } from '../routing/router.interface';
import { Newable } from '../types/newable.type';
import { FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
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
 * One document the explorer offers.
 */
type ExplorerDocument = {
    /**
     * Where the document is served.
     */
    url: string,
    /**
     * What the explorer calls it: the version, and when it was in use.
     */
    name: string
};

/**
 * What the scripts of the explorer read from its page.
 */
type ExplorerConfiguration = {
    /**
     * The name of the application, shown beside its logo.
     */
    appName: string,
    /**
     * Where the logo is served.
     */
    logoSrc: string,
    /**
     * The document of every version, the latest first.
     */
    urls: ExplorerDocument[],
    /**
     * The name of the version the explorer opens with.
     */
    primaryName: string
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
        private readonly auth: RouteAuthConfiguration
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

        this.logger.info(`registers the OpenAPI Explorer at ${this.openApiRoute}`);

        const assetFiles: string[] = [
            'swagger-ui.css',
            'swagger-ui-bundle.js',
            'swagger-ui-standalone-preset.js',
            'swagger-ui-init.js',
            'custom.js'
        ];
        // the application's own files, in its assets next to custom.css, so that it can change what
        // the explorer looks like and adds to swagger-ui
        for (const file of assetFiles) {
            this.router.registerRoute({
                httpMethod: HttpMethod.GET,
                route: `${this.openApiRoute}/${file}`,
                versions: 'all',
                openApi: { useInOpenApi: false },
                auth: this.auth,
                handler: () => FileResponse.fromPath(FsUtilities.getPath(this.assetService.publicAssetsPath, 'open-api', file))
            });
        }

        this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: this.openApiRoute,
            versions: 'all',
            openApi: { useInOpenApi: false },
            auth: this.auth,
            handler: () => {
                const appName: string = app.options.name;
                return HtmlResponse.fromString(
                    `<!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <title>${HtmlUtilities.escape(appName)} | Explorer</title>
                        <link rel="stylesheet" href="${this.openApiRoute}/swagger-ui.css">
                        <link rel="icon" href="${this.assetService.assetsRoute}/favicon.png">
                        <link rel="stylesheet" href="${this.assetService.assetsRoute}/open-api/custom.css">
                    </head>
                    <body>
                        <div id="swagger-ui"></div>
                        <script id="zibri-explorer-config" type="application/json">${this.resolveExplorerConfiguration(appName)}</script>
                        <script src="${this.openApiRoute}/swagger-ui-bundle.js"></script>
                        <script src="${this.openApiRoute}/swagger-ui-standalone-preset.js"></script>
                        <script src="${this.openApiRoute}/swagger-ui-init.js"></script>
                        <script src="${this.openApiRoute}/custom.js"></script>
                    </body>
                    </html>`,
                    {
                        csp: {
                            styleSrc: ['\'self\'', '\'unsafe-hashes\'', '\'sha256-RL3ie0nH+Lzz2YNqQN83mnU0J1ot4QL7b99vMdIX99w=\''],
                            imgSrc: ['\'self\'', 'data:']
                        }
                    }
                );
            }
        });
    }

    /**
     * What the scripts of the explorer read from its page.
     * @param appName - The name of the application.
     * @returns The configuration, as json that can stand inside a script element.
     */
    private resolveExplorerConfiguration(appName: string): string {
        const versions: VersionFile[] = this.versioningService
            .getVersions()
            .sort((a, b) => SemVerUtilities.compare(a.value, b.value) === 'bigger' ? -1 : 1);
        const configuration: ExplorerConfiguration = {
            appName,
            logoSrc: `${this.assetService.assetsRoute}/logo.jpg`,
            urls: versions.map(v => ({
                url: `${this.openApiRoute}/spec/${v.value}`,
                name: v.endsAt == undefined
                    ? `${v.value} (latest)`
                    : `${v.value} (${$f.date(v.startsAt)} - ${$f.date(v.endsAt)})`
            })),
            primaryName: versions.find(v => v.endsAt == undefined)?.value ?? ''
        };
        // a "<" escaped inside the strings, where json allows it, so that no value can end the
        // script element early with "</script>"
        return JsonUtilities.stringify(configuration).replaceAll('<', '\\u003c');
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