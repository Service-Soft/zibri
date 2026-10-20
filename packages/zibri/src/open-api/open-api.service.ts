import { Readable } from 'node:stream';

import { OpenApiServiceInterface } from './open-api-service.interface.ts';
import { OpenApiDefinition, OpenApiTagObject, OpenApiSecuritySchemeObject, OpenApiPaths, OpenApiResponse, OpenApiOperation, OpenApiResponsesObject, OpenApiResponseObject, OpenApiContentObject, OpenApiSchemaObject, OpenApiSecurityRequirementObject, OpenApiRequestBodyObject, OpenApiParameterLocation, OpenApiParameter, OpenApiReferenceObject, isOpenApiReferenceObject, JsonOpenApiResponse, OpenApiXmlObject } from './open-api.model.ts';
import { resolveResponseClass } from './resolve-response-class.function.ts';
import { ZibriApplication } from '../application/application.ts';
import { type AssetServiceInterface } from '../assets/asset-service.interface.ts';
import { type AuthServiceInterface } from '../auth/auth-service.interface.ts';
import { ResolvedAuthMetadata } from '../auth/models/resolved-auth-metadata.model.ts';
import { type RouteAuthConfiguration } from '../auth/models/route-auth-configuration.model.ts';
import { Inject } from '../di/decorators/inject.decorator.ts';
import { Injectable } from '../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { BaseEntity } from '../entity/base-entity.model.ts';
import { EntityMetadata } from '../entity/decorators/entity.decorator.ts';
import { PropertyMetadata } from '../entity/decorators/property.decorator.ts';
import { ArrayPropertyItemMetadata } from '../entity/models/array-property-metadata.model.ts';
import { BelongsToOnePropertyMetadata } from '../entity/models/belongs-to-one-property-metadata.model.ts';
import { BooleanPropertyMetadata } from '../entity/models/boolean-property-metadata.model.ts';
import { HasOnePropertyMetadata } from '../entity/models/has-one-property-metadata.model.ts';
import { ManyToManyPropertyMetadata } from '../entity/models/many-to-many-property-metadata.model.ts';
import { ManyToOnePropertyMetadata } from '../entity/models/many-to-one-property-metadata.model.ts';
import { NumberFormat, NumberPropertyMetadata } from '../entity/models/number-property-metadata.model.ts';
import { AnyOfShapesMetadata, OneOfShapeMetadata } from '../entity/models/one-of-property-metadata.model.ts';
import { OneToManyPropertyMetadata } from '../entity/models/one-to-many-property-metadata.model.ts';
import { RelationType } from '../entity/models/relation-type.enum.ts';
import { StringPropertyMetadata } from '../entity/models/string-property-metadata.model.ts';
import { OmitClass } from '../entity/omit-class.model.ts';
import { NotFoundError } from '../error-handling/errors/not-found.error.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { AfterAppInit } from '../global/after-app-init.interface.ts';
import { GlobalRegistry } from '../global/global-registry.ts';
import { OnAppStart } from '../global/on-app-start.interface.ts';
import { RouteRegistry } from '../global/route-registry/route.registry.ts';
import { HttpMethod, httpMethodKey } from '../http/http-method.enum.ts';
import { HttpStatus } from '../http/http-status.enum.ts';
import { KnownHeader } from '../http/known-header.enum.ts';
import { MimeType } from '../http/mime-type.enum.ts';
import { $f } from '../localization/format.function.ts';
import { $ts } from '../localization/translate.function.ts';
import { type LoggerInterface } from '../logging/logger.interface.ts';
import { FileResponse } from '../parsing/form-data/file-response.model.ts';
import { HtmlResponse } from '../parsing/html/html-response.model.ts';
import { XmlModelUtilities } from '../parsing/xml/xml-model.utilities.ts';
import { XmlPropertyMetadata } from '../parsing/xml/xml-property-metadata.model.ts';
import { XmlRootMetadata } from '../parsing/xml/xml-root-metadata.model.ts';
import { Route, ControllerRouteConfiguration } from '../routing/controller-route-configuration.model.ts';
import { BodyMetadata } from '../routing/decorators/body-metadata.model.ts';
import { ControllerData } from '../routing/decorators/controller.decorator.ts';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata } from '../routing/decorators/param.decorator.ts';
import { MissingBaseRouteError } from '../routing/missing-base-route.error.ts';
import { ArrayParamItemMetadata } from '../routing/models/array-param-metadata.model.ts';
import { type RouterInterface } from '../routing/router.interface.ts';
import { Newable } from '../types/newable.type.ts';
import { FsUtilities, FsPath } from '../utilities/fs.utilities.ts';
import { JsonUtilities } from '../utilities/json.utilities.ts';
import { MetadataUtilities } from '../utilities/metadata.utilities.ts';
import { ObjectUtilities } from '../utilities/object.utilities.ts';
import { SemVerUtilities } from '../versioning/sem-ver.utilities.ts';
import { SupportedVersionsOptions } from '../versioning/supported-versions-options.model.ts';
import { Version, VersionFile } from '../versioning/version.model.ts';
import { type VersioningServiceInterface } from '../versioning/versioning-service.interface.ts';

const defaultDescriptionForHttpStatus: Record<HttpStatus | 'default', string> = {
    default: 'Response',
    [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
    [HttpStatus.NOT_FOUND]: 'Not Found',
    [HttpStatus.BAD_REQUEST]: 'Bad Request',
    [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
    [HttpStatus.FORBIDDEN]: 'Forbidden',
    [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
    [HttpStatus.OK]: 'Ok',
    [HttpStatus.CREATED]: 'Created',
    [HttpStatus.CONTINUE]: 'Continue',
    [HttpStatus.SWITCHING_PROTOCOLS]: '',
    [HttpStatus.PROCESSING]: '',
    [HttpStatus.ACCEPTED]: '',
    [HttpStatus.NON_AUTHORITATIVE_INFORMATION]: '',
    [HttpStatus.NO_CONTENT]: '',
    [HttpStatus.RESET_CONTENT]: '',
    [HttpStatus.PARTIAL_CONTENT]: '',
    [HttpStatus.MULTIPLE_CHOICES]: '',
    [HttpStatus.MOVED_PERMANENTLY]: '',
    [HttpStatus.FOUND]: '',
    [HttpStatus.SEE_OTHER]: '',
    [HttpStatus.NOT_MODIFIED]: '',
    [HttpStatus.TEMPORARY_REDIRECT]: '',
    [HttpStatus.PERMANENT_REDIRECT]: '',
    [HttpStatus.PAYMENT_REQUIRED]: '',
    [HttpStatus.METHOD_NOT_ALLOWED]: '',
    [HttpStatus.NOT_ACCEPTABLE]: '',
    [HttpStatus.REQUEST_TIMEOUT]: '',
    [HttpStatus.CONFLICT]: '',
    [HttpStatus.GONE]: '',
    [HttpStatus.PRECONDITION_FAILED]: '',
    [HttpStatus.CONTENT_TOO_LARGE]: '',
    [HttpStatus.URI_TOO_LONG]: '',
    [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: '',
    [HttpStatus.UNPROCESSABLE_ENTITY]: '',
    [HttpStatus.REQUEST_HEADER_FIELDS_TOO_LARGE]: '',
    [HttpStatus.NOT_IMPLEMENTED]: '',
    [HttpStatus.BAD_GATEWAY]: '',
    [HttpStatus.SERVICE_UNAVAILABLE]: '',
    [HttpStatus.GATEWAY_TIMEOUT]: '',
    [HttpStatus.HTTP_VERSION_NOT_SUPPORTED]: ''
};

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
 * How one kind of number is described in an open api document.
 */
type OpenApiNumberType = {
    /**
     * The json type a value of it arrives and leaves as.
     */
    type: 'number' | 'integer' | 'string',
    /**
     * What that json type is carrying, in open api's own vocabulary.
     */
    format: string
};

/**
 * What a string schema is built from, shared by string properties and string parameters.
 */
type StringSchemaSource = Pick<
    StringPropertyMetadata<unknown, unknown, never, never, never>,
    'format' | 'description' | 'minLength' | 'maxLength' | 'regex' | 'enum'
>;

/**
 * What a number schema is built from, shared by number properties and number parameters.
 */
type NumberSchemaSource = Pick<NumberPropertyMetadata, 'format' | 'description' | 'min' | 'max' | 'enum'>;

/**
 * What a boolean schema is built from, shared by boolean properties and boolean parameters.
 */
type BooleanSchemaSource = Pick<BooleanPropertyMetadata, 'description'>;

/**
 * Default open api service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class OpenApiService implements OpenApiServiceInterface, AfterAppInit, OnAppStart {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onAppStart(app: ZibriApplication): Promise<void> {
        this.definitions = await Promise.all(
            this.versioningService.getVersions().map(
                async v => ({ version: v, definition: await this.createOpenApiDefinition(app, v) })
            )
        );
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    afterAppInit(): void {
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

        this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/swagger-ui.css`,
            versions: 'all',
            openApi: { useInOpenApi: false },
            auth: this.auth,
            handler: () => {
                const filePath: FsPath = FsUtilities.getPath(this.assetService.publicAssetsPath, 'open-api', 'swagger-ui.css');
                return FileResponse.fromPath(filePath);
            }
        });
        this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/swagger-ui-bundle.js`,
            versions: 'all',
            openApi: { useInOpenApi: false },
            auth: this.auth,
            handler: () => {
                const filePath: FsPath = FsUtilities.getPath(this.assetService.publicAssetsPath, 'open-api', 'swagger-ui-bundle.js');
                return FileResponse.fromPath(filePath);
            }
        });
        this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/swagger-ui-standalone-preset.js`,
            versions: 'all',
            openApi: { useInOpenApi: false },
            auth: this.auth,
            handler: () => {
                const filePath: FsPath = FsUtilities.getPath(
                    this.assetService.publicAssetsPath,
                    'open-api',
                    'swagger-ui-standalone-preset.js'
                );
                return FileResponse.fromPath(filePath);
            }
        });
        this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/swagger-ui-init.js`,
            versions: 'all',
            openApi: { useInOpenApi: false },
            auth: this.auth,
            handler: () => {
                const versions: VersionFile[] = this.versioningService
                    .getVersions()
                    .sort((a, b) => SemVerUtilities.compare(a.value, b.value) === 'bigger' ? -1 : 1);
                // eslint-disable-next-line jsdoc-js/require-jsdoc
                const urls: { url: string, name: string }[] = versions.map(v => {
                    return {
                        url: `${this.openApiRoute}/spec/${v.value}`,
                        name: v.endsAt == undefined
                            ? `${v.value} (latest)`
                            : `${v.value} (${$f.date(v.startsAt)} - ${$f.date(v.endsAt)})`
                    };
                });
                const latestVersion: VersionFile | undefined = versions.find(v => v.endsAt == undefined);
                return FileResponse.fromStream({
                    filename: 'swagger-ui-init.js',
                    mimeType: MimeType.JAVASCRIPT,
                    stream: Readable.from([
                        [
                            'window.onload = function() {',
                            '    window.ui = SwaggerUIBundle({',
                            `        urls: ${JsonUtilities.stringify(urls)},`,
                            `        "urls.primaryName": "${latestVersion?.value ?? ''}",`,
                            '        dom_id: \'#swagger-ui\',',
                            '        presets: [',
                            '            SwaggerUIBundle.presets.apis,',
                            '            SwaggerUIStandalonePreset',
                            '        ],',
                            '        layout: "StandaloneLayout",',
                            '        requestInterceptor: (req) => {',
                            '            req.headers.Accept = \'application/json\'',
                            `            req.headers['${KnownHeader.CONTENT_TYPE}'] = 'application/json'`,
                            '            return req;',
                            '        },',
                            '        defaultModelRendering: \'model\',',
                            '        persistAuthorization: true',
                            '    });',
                            '};'
                        ].join('\n')
                    ])
                });
            }
        });

        this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/custom.js`,
            versions: 'all',
            openApi: { useInOpenApi: false },
            auth: this.auth,
            handler: () => {
                return FileResponse.fromStream({
                    filename: 'custom.js',
                    mimeType: MimeType.JAVASCRIPT,
                    stream: Readable.from([
                        [
                            '(function() {',
                            '    function injectLogo(topbar) {',
                            '        if (topbar.querySelector(\'#zibri-openapi-logo\')) {',
                            '            return;',
                            '        }',
                            '        const a = document.createElement(\'a\');',
                            '        a.id = \'zibri-openapi-logo\';',
                            '        a.href = \'/\';',
                            '',
                            '        const img = document.createElement(\'img\');',
                            `        img.src = '${this.assetService.assetsRoute}/logo.jpg';`,
                            '        img.height = 100;',
                            '        img.width = 100;',
                            '',
                            '        a.appendChild(img);',
                            `        a.append('${GlobalRegistry.getAppData('name')}');`,
                            '        topbar.insertBefore(a, topbar.firstChild);',
                            '    }',
                            '',
                            '    function observe() {',
                            '        const topbar = document.querySelector(\'.information-container\');',
                            '        if (!topbar) {',
                            '            setTimeout(observe, 50);',
                            '            return;',
                            '        }',
                            '        injectLogo(topbar);',
                            '        new MutationObserver(() => {',
                            '            const t = document.querySelector(\'.information-container\');',
                            '            if (t) {',
                            '                injectLogo(t);',
                            '            }',
                            '        }).observe(document.body, { childList: true, subtree: true });',
                            '    }',
                            '',
                            '    observe();',
                            '})();',
                            '',
                            '(function() {',
                            '    let isInjecting = false;',
                            '',
                            '    function injectRoles() {',
                            '        if (isInjecting) return;',
                            '        if (!window.ui || typeof window.ui.specSelectors !== \'object\') return;',
                            '',
                            '        const spec = window.ui.specSelectors.specJson().toJS',
                            '            ? window.ui.specSelectors.specJson().toJS()',
                            '            : window.ui.specSelectors.specJson();',
                            '',
                            '        if (!spec || !spec.paths) return;',
                            '',
                            '        isInjecting = true;',
                            '        try {',
                            '            const normalizeMethod = (m) => String(m).toLowerCase();',
                            '',
                            // cspell:disable-next-line
                            '            const opBlocks = document.querySelectorAll(\'.opblock\');',
                            '            opBlocks.forEach((op) => {',
                            '                try {',
                            // cspell:disable-next-line
                            '                    const methodEl = op.querySelector(\'.opblock-summary-method\');',
                            // cspell:disable-next-line
                            '                    const pathEl = op.querySelector(\'.opblock-summary-path\');',
                            '                    if (!methodEl || !pathEl) return;',
                            '',
                            '                    const method = normalizeMethod(methodEl.textContent.trim());',
                            '                    const path = pathEl.textContent.trim();',
                            '',
                            '                    const pathObj = spec.paths[path];',
                            '                    if (!pathObj) return;',
                            '',
                            '                    const operationObj = pathObj[method];',
                            '                    if (!operationObj) return;',
                            '',
                            '                    const roles = operationObj[\'x-roles\'];',
                            '                    if (!roles || !Array.isArray(roles) || roles.length === 0) return;',
                            '',
                            '                    if (op.querySelector(\'.zibri-roles-container\')) return;',
                            '',
                            '                    const container = document.createElement(\'div\');',
                            '                    container.className = \'zibri-roles-container\';',
                            '                    container.setAttribute(\'aria-hidden\', \'true\');',
                            '',
                            '                    roles.forEach((r) => {',
                            '                        const badge = document.createElement(\'span\');',
                            '                        badge.className = \'zibri-role-badge\';',
                            '                        badge.textContent = String(r);',
                            '                        container.appendChild(badge);',
                            '                    });',
                            '',
                            // cspell:disable-next-line
                            '                    const summary = op.querySelector(\'.opblock-summary-path-description-wrapper\');',
                            '                    if (summary) summary.appendChild(container);',
                            '                } catch (e) {',
                            '                    console.warn(\'zibri openapi role injection failed\', e);',
                            '                }',
                            '            });',
                            '        } finally {',
                            '            isInjecting = false;',
                            '        }',
                            '    }',
                            '',
                            '    function waitForSwaggerAndObserve() {',
                            '        if (!window.ui || typeof window.ui.specSelectors !== \'object\') {',
                            '            return setTimeout(waitForSwaggerAndObserve, 50);',
                            '        }',
                            '',
                            '        const spec = window.ui.specSelectors.specJson().toJS',
                            '            ? window.ui.specSelectors.specJson().toJS()',
                            '            : window.ui.specSelectors.specJson();',
                            '',
                            '        if (!spec || !spec.paths) {',
                            '            return setTimeout(waitForSwaggerAndObserve, 50);',
                            '        }',
                            '',
                            '        // Initial injection',
                            '        injectRoles();',
                            '',
                            '        // Watch for version switches / re-renders',
                            '        const swaggerContainer = document.getElementById(\'swagger-ui\');',
                            '        if (!swaggerContainer) return;',
                            '',
                            '        let debounceTimer;',
                            '        const observer = new MutationObserver(() => {',
                            '            clearTimeout(debounceTimer);',
                            '            debounceTimer = setTimeout(() => {',
                            '                injectRoles();',
                            '            }, 200);',
                            '        });',
                            '',
                            '        observer.observe(swaggerContainer, { childList: true, subtree: true });',
                            '    }',
                            '',
                            '    waitForSwaggerAndObserve();',
                            '})();'
                        ].join('\n')
                    ])
                });
            }
        });

        this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: this.openApiRoute,
            versions: 'all',
            openApi: { useInOpenApi: false },
            auth: this.auth,
            handler: () => {
                return HtmlResponse.fromString(
                    `<!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <title>${GlobalRegistry.getAppData('name')} | Explorer</title>
                        <link rel="stylesheet" href="${this.openApiRoute}/swagger-ui.css">
                        <link rel="icon" href="${this.assetService.assetsRoute}/favicon.png">
                        <link rel="stylesheet" href="${this.assetService.assetsRoute}/open-api/custom.css">
                    </head>
                    <body>
                        <div id="swagger-ui"></div>
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async createOpenApiDefinition(app: ZibriApplication, version: Version): Promise<OpenApiDefinition> {
        const tags: OpenApiTagObject[] = app.options.controllers.map(cls => ({ name: cls.name }));
        const res: OpenApiDefinition = {
            openapi: '3.1.0',
            info: {
                title: `${GlobalRegistry.getAppData('name')} | Explorer`,
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

    // eslint-disable-next-line sonarjs/cognitive-complexity
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

                const { hasRole: hasRoleMetadata, hasPlatformRole: hasPlatformRoleMetadata }: ResolvedAuthMetadata = RouteRegistry.get(
                    controllerClass,
                    route.controllerMethod
                ).auth.metadata;

                const operation: OpenApiOperation = {
                    description: this.describeScopes(responses),
                    responses: this.buildResponses(responses),
                    tags: [controllerClass.name],
                    parameters: [
                        ...this.buildParameters(pathParams, 'path'),
                        ...this.buildParameters(queryParams, 'query'),
                        ...this.buildParameters(headerParams, 'header')
                    ],
                    requestBody: this.buildOpenApiBody(bodyMetadata),
                    security: await this.resolveOperationSecurity(controllerClass, route.controllerMethod),
                    ['x-roles']: hasRoleMetadata?.allowedRoles,
                    ['x-platform-roles']: hasPlatformRoleMetadata?.allowedRoles
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
                responses: this.buildResponses(route.openApi.responses),
                tags: route.openApi.tags,
                parameters: [
                    ...this.buildParameters(route.pathParams, 'path'),
                    ...this.buildParameters(route.queryParams, 'query'),
                    ...this.buildParameters(route.headerParams, 'header')
                ],
                requestBody: this.buildOpenApiBody(route.bodyMetadata),
                // a manually registered route had no posture to document, so this was a comment. Now
                // that it states one - or inherits `defaultAuth` by stating nothing - the spec says
                // the same thing about it that it says about a controller route
                security: this.resolveRouteSecurity(route.auth),
                ['x-roles']: route.auth?.hasRole?.allowedRoles,
                ['x-platform-roles']: route.auth?.hasPlatformRole?.allowedRoles
            };
            res[fullPath][httpMethodKey(route.httpMethod)] = operation;
        }

        return res;
    }

    private buildResponses(responses: OpenApiResponse[]): OpenApiResponsesObject | undefined {
        const res: OpenApiResponsesObject = {};

        const groupedResponses: Record<string, OpenApiResponse[]> = {};
        for (const response of responses) {
            const status: string = `${response.status ?? 'default'}`;
            const group: OpenApiResponse[] = groupedResponses[status] ?? [];
            group.push(response);
            groupedResponses[status] = group;
        }

        for (const [status, r] of ObjectUtilities.entries(groupedResponses)) {
            const response: OpenApiResponse | undefined = r.length === 1 ? r[0] : undefined;
            if (response == undefined) {
                const data: OpenApiResponseObject = {
                    description: '',
                    content: this.buildResponsesContent(r)
                };
                res[status] = data;
            }
            else {
                const data: OpenApiResponseObject = {
                    description: response.description ?? defaultDescriptionForHttpStatus[response.status ?? 'default'],
                    content: this.buildResponseContent(response),
                    // where a redirect sends the caller is all it says
                    ...response.type === 'redirect'
                        ? { headers: { [KnownHeader.LOCATION]: { schema: { type: 'string', format: 'uri' } } } }
                        : {}
                };
                res[status] = data;
            }
        }

        return res;
    }

    // eslint-disable-next-line sonarjs/cognitive-complexity
    private buildResponseContent(response: OpenApiResponse): OpenApiContentObject | undefined {
        switch (response.type) {
            case 'file': {
                const schema: OpenApiSchemaObject = { type: 'string', format: 'binary' };
                // normalize mimeType into an array; default to octet‑stream
                const mimeTypes: MimeType[] = Array.isArray(response.mimeType)
                    ? response.mimeType
                    : response.mimeType != undefined
                        ? [response.mimeType === 'all' ? MimeType.OCTET_STREAM : response.mimeType]
                        : [MimeType.OCTET_STREAM];

                const content: OpenApiContentObject = {};
                for (const mt of mimeTypes) {
                    content[mt] = { schema };
                }
                return content;
            }
            case 'json': {
                const cls: Newable<unknown> | undefined = resolveResponseClass(response);
                if (!cls) {
                    return undefined;
                }
                const propMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
                const schema: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(propMeta, cls, 'response', new Set());

                if (response.isArray === true) {
                    return { [MimeType.JSON]: { schema: { type: 'array', items: schema } } };
                }

                const content: OpenApiContentObject = {};
                for (const mimeType of response.mimeTypes ?? [MimeType.JSON]) {
                    content[mimeType] = { schema: mimeType === MimeType.XML ? this.withXmlRoot(schema, cls) : schema };
                }
                return content;
            }
            case 'html': {
                const schema: OpenApiSchemaObject = {
                    type: 'string',
                    format: 'html'
                };
                return { [MimeType.HTML]: { schema } };
            }
            case 'empty':
            case 'redirect':
            case 'error': {
                return undefined;
            }
            default: {
                throw new InternalError(`Unknown response type ${(response as OpenApiResponse).type}`);
            }
        }

    }

    private buildResponsesContent(responses: OpenApiResponse[]): OpenApiContentObject | undefined {
        const schemas: OpenApiSchemaObject[] = [];
        const xmlSchemas: OpenApiSchemaObject[] = [];
        for (const response of responses) {
            switch (response.type) {
                case 'file': {
                    schemas.push({ type: 'string', format: 'binary' });
                    continue;
                }
                case 'html': {
                    schemas.push({ type: 'string', format: 'html' });
                    continue;
                }
                case 'json': {
                    this.addModelSchemas(response, schemas, xmlSchemas);
                    continue;
                }
                case 'empty':
                case 'redirect':
                case 'error': {
                    continue;
                }
                default: {
                    throw new InternalError(`Unknown response type ${(response as OpenApiResponse).type}`);
                }
            }

        }

        if (!xmlSchemas.length) {
            return { [MimeType.JSON]: { schema: { oneOf: schemas } } };
        }
        return {
            ...schemas.length ? { [MimeType.JSON]: { schema: { oneOf: schemas } } } : {},
            [MimeType.XML]: { schema: { oneOf: xmlSchemas } }
        };
    }

    /**
     * Adds the schema of a model response to the formats it can be written in.
     * @param response - The declared response.
     * @param schemas - The schemas of the json content, added to.
     * @param xmlSchemas - The schemas of the xml content, added to.
     */
    private addModelSchemas(response: JsonOpenApiResponse, schemas: OpenApiSchemaObject[], xmlSchemas: OpenApiSchemaObject[]): void {
        const cls: Newable<unknown> | undefined = resolveResponseClass(response);
        if (!cls) {
            return;
        }
        const propMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        const schema: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(propMeta, cls, 'response', new Set());
        if (response.isArray === true) {
            schemas.push({ type: 'array', items: schema });
            return;
        }
        const mimeTypes: MimeType[] = response.mimeTypes ?? [MimeType.JSON];
        if (mimeTypes.includes(MimeType.JSON)) {
            schemas.push(schema);
        }
        if (mimeTypes.includes(MimeType.XML)) {
            xmlSchemas.push(this.withXmlRoot(schema, cls));
        }
    }

    /**
     * The schema of a model as the root element of an xml document: named, and in the namespace, that `@XmlRoot` gives it.
     * @param schema - The schema of the model.
     * @param cls - The model.
     * @returns The schema, naming its element.
     */
    private withXmlRoot(schema: OpenApiSchemaObject, cls: Newable<unknown>): OpenApiSchemaObject {
        const root: XmlRootMetadata | undefined = MetadataUtilities.findXmlRoot(cls);
        const prefix: string | undefined = this.findXmlPrefix(root, root?.namespace);
        return {
            ...this.qualifyXmlElements(schema, cls, root),
            xml: { name: root?.name ?? cls.name, namespace: root?.namespace, ...prefix == undefined ? {} : { prefix } }
        };
    }

    /**
     * Copies the schema of a model inside an xml document, naming the namespace of each child element that is not
     * in the document's default one.
     *
     * Which namespace an element is in depends on the document, not only on its model: a model without a namespace
     * of its own takes the document's. So this is done per document, on a copy, leaving the schema json uses as it
     * is.
     * @param schema - The schema of the model.
     * @param cls - The model.
     * @param root - The root of the document.
     * @returns The schema, its child elements qualified.
     */
    private qualifyXmlElements(schema: OpenApiSchemaObject, cls: Newable<unknown>, root: XmlRootMetadata | undefined): OpenApiSchemaObject {
        if (schema.properties == undefined) {
            return schema;
        }
        // the root's namespace is written without a prefix unless it has one, as the writer does. An element
        // in the default namespace needs nothing, since it inherits the declaration on the root
        const defaultNamespace: string | undefined = this.findXmlPrefix(root, root?.namespace) == undefined ? root?.namespace : undefined;
        const namespace: string | undefined = XmlModelUtilities.resolveNamespace(cls, root?.namespace);
        const prefix: string | undefined = this.findXmlPrefix(root, namespace);
        const qualified: OpenApiXmlObject = namespace === defaultNamespace
            ? {}
            : { namespace, ...prefix == undefined ? {} : { prefix } };

        const models: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        const properties: Record<string, OpenApiSchemaObject | OpenApiReferenceObject> = {};
        for (const [key, property] of ObjectUtilities.entries(schema.properties)) {
            const metadata: PropertyMetadata | undefined = models[key];
            // attributes are written without a namespace, and mixed content has no form in this version of
            // OpenAPI at all, so its elements are not described either
            properties[key] = isOpenApiReferenceObject(property)
                || metadata == undefined
                || XmlModelUtilities.getXmlProperty(cls, key).kind !== 'element'
                ? property
                : this.qualifyXmlElement(property, metadata, qualified, root);
        }
        return { ...schema, properties };
    }

    /**
     * Qualifies the element of one property, and the elements of the model it holds.
     * @param property - The schema of the property.
     * @param metadata - The property.
     * @param qualified - The namespace of the element.
     * @param root - The root of the document.
     * @returns The schema, qualified.
     */
    private qualifyXmlElement(
        property: OpenApiSchemaObject,
        metadata: PropertyMetadata,
        qualified: OpenApiXmlObject,
        root: XmlRootMetadata | undefined
    ): OpenApiSchemaObject {
        switch (metadata.type) {
            case 'object': {
                return { ...this.qualifyXmlElements(property, metadata.cls(), root), xml: { ...property.xml, ...qualified } };
            }
            case 'array': {
                // a list is its element repeated rather than wrapped, so the element is its items
                if (property.items == undefined || isOpenApiReferenceObject(property.items)) {
                    return property;
                }
                const items: OpenApiSchemaObject = metadata.items.type === 'object'
                    ? this.qualifyXmlElements(property.items, metadata.items.cls(), root)
                    : property.items;
                return { ...property, items: { ...items, xml: { ...property.items.xml, ...qualified } } };
            }
            case 'string':
            case 'number':
            case 'boolean':
            case 'date':
            case 'file':
            case 'oneOf':
            case 'unknown':
            case RelationType.HAS_ONE:
            case RelationType.BELONGS_TO_ONE:
            case RelationType.ONE_TO_MANY:
            case RelationType.MANY_TO_ONE:
            case RelationType.MANY_TO_MANY: {
                return { ...property, xml: { ...property.xml, ...qualified } };
            }
        }
    }

    private findXmlPrefix(root: XmlRootMetadata | undefined, namespace: string | undefined): string | undefined {
        return ObjectUtilities.entries(root?.prefixes ?? {}).find(([, prefixed]) => prefixed === namespace)?.[0];
    }

    /**
     * Says how the properties of a model appear in xml, where that is not as a child element of their own name.
     *
     * On the schema json uses too, which is safe: json ignores it. The element's own text and mixed content have no
     * form in this version of OpenAPI, so a property read from either is described like a child element. Which
     * namespace an element is in is the document's to say, see `qualifyXmlElements`.
     * @param properties - The schemas of the model's properties, by property.
     * @param cls - The model.
     */
    private annotateXml(properties: Record<string, OpenApiSchemaObject>, cls: Newable<unknown>): void {
        for (const [key, property] of ObjectUtilities.entries(properties)) {
            const xml: XmlPropertyMetadata = XmlModelUtilities.getXmlProperty(cls, key);
            switch (xml.kind) {
                case 'attribute': {
                    properties[key] = { ...property, xml: { name: xml.name, attribute: true } };
                    break;
                }
                case 'element': {
                    // a property without a decorator is its element already
                    if (!Object.hasOwn(MetadataUtilities.getXmlProperties(cls), key)) {
                        break;
                    }
                    const element: OpenApiXmlObject = { name: xml.name };
                    // a list is its element repeated rather than wrapped, so the name belongs to its items
                    properties[key] = property.items != undefined && !isOpenApiReferenceObject(property.items)
                        ? { ...property, items: { ...property.items, xml: element } }
                        : { ...property, xml: element };
                    break;
                }
                case 'text':
                case 'mixed': {
                    break;
                }
            }
        }
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

        if (!scoped.length) {
            return undefined;
        }
        return `Restricted to what the caller is allowed to see. A ${scoped.join(' or ')} outside that is absent `
            + 'from a list and answered with a 404 when named directly.';
    }

    private async resolveOperationSecurity(
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ): Promise<OpenApiSecurityRequirementObject[] | undefined> {
        const res: OpenApiSecurityRequirementObject[] = [];

        // asked of the auth service rather than derived from the decorators here: a route requires a
        // login under `defaultAuth: 'requireLogin'` without carrying a single one of them, and
        // reading the decorators alone documented every such route as public - the spec is what
        // consumers read instead of the code, so it said the opposite of what the route does.
        if (!await this.authService.requiresAuthentication(controllerClass, controllerMethod)) {
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
        if (!this.authService.requiresRouteAuthentication(auth)) {
            return undefined;
        }
        return this.authService.strategies.map(s => ({ [inject(s).name]: [] }));
    }

    private buildOpenApiBody(metadata: BodyMetadata | undefined): OpenApiRequestBodyObject | undefined {
        if (!metadata) {
            return undefined;
        }

        const schema: OpenApiSchemaObject | OpenApiReferenceObject = metadata.type === MimeType.OCTET_STREAM
            ? {
                type: 'string',
                format: 'binary'
            }
            : this.buildShapeSchema(metadata.shape, 'request');
        // an xml body of one model is that model's document, whose root element it names
        const rooted: OpenApiSchemaObject | OpenApiReferenceObject = metadata.type === MimeType.XML
            && metadata.shape.type === 'object'
            && !isOpenApiReferenceObject(schema)
            ? this.withXmlRoot(schema, metadata.shape.cls())
            : schema;
        return {
            required: typeof metadata.required === 'boolean' ? metadata.required : undefined,
            description: metadata.description,
            content: { [metadata.type]: { schema: rooted } }
        };
    }

    /**
     * The schema of a value of one shape, on its own rather than as a property of a model.
     * @param shape - The shape.
     * @param context - Whether the value is sent or answered with.
     * @returns Its schema.
     */
    private buildShapeSchema(
        shape: ArrayPropertyItemMetadata | AnyOfShapesMetadata,
        context: 'request' | 'response'
    ): OpenApiSchemaObject | OpenApiReferenceObject {
        if (shape.type === 'anyOf') {
            return this.buildAnyOfSchema(shape.shapes, undefined, context);
        }
        return this.buildOpenApiSchemaForProperties({ shape }, class {}, context, new Set()).properties?.['shape'] ?? {};
    }

    /**
     * The schema of a value that is the first of several shapes it fits.
     *
     * AnyOf rather than oneOf: oneOf says exactly one shape matches, and a value is read as the first
     * shape it fits even where a later one would match too - a date is also text.
     * @param shapes - The shapes, in order.
     * @param description - What the value is.
     * @param context - Whether the value is sent or answered with.
     * @returns Its schema.
     */
    private buildAnyOfSchema(
        shapes: OneOfShapeMetadata[],
        description: string | undefined,
        context: 'request' | 'response'
    ): OpenApiSchemaObject {
        return { description, anyOf: shapes.map(shape => this.buildShapeSchema(shape, context)) };
    }

    private buildOpenApiSchemaForProperties(
        propMeta: Record<string, PropertyMetadata>,
        entity: Newable<unknown>,
        context: 'request' | 'response',
        visited: Set<Newable<unknown>>
    ): OpenApiSchemaObject {
        // ---- cycle guard ----
        if (visited.has(entity)) {
        // Return a stub schema (or a ref if you later extract components).
        // Returning an empty object is safe, but a description helps debugging.
            return { type: 'object', description: 'Circular reference omitted' };
        }
        visited.add(entity);

        const properties: Record<string, OpenApiSchemaObject> = {};
        const required: string[] = [];

        for (const [key, meta] of ObjectUtilities.entries(propMeta)) {
            if (meta.exclude === true && context === 'response') {
                continue;
            }
            // mark required
            if (
                (typeof meta.required === 'boolean' ? meta.required : false)
                && (!('default' in meta) || meta.default == undefined)
                && (meta.exclude === false || context === 'response')
            ) {
                required.push(key);
            }
            switch (meta.type) {
                case 'date': {
                    properties[key] = {
                        type: 'string',
                        format: 'date-time',
                        description: meta.description
                        // default: meta.default
                    };
                    continue;
                }
                case 'number': {
                    properties[key] = this.numberSchema(meta, meta.default);
                    continue;
                }
                case 'boolean': {
                    properties[key] = this.booleanSchema(meta, meta.default);
                    continue;
                }
                case 'file': {
                    properties[key] = { type: 'string', format: 'binary', description: meta.description };
                    continue;
                }
                case 'string': {
                    properties[key] = this.stringSchema(meta, meta.default);
                    continue;
                }
                case 'object': {
                    const targetClass: Newable<unknown> = meta.cls();
                    const objectPropMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetClass);
                    const objectSchema: OpenApiSchemaObject
                        = this.buildOpenApiSchemaForProperties(objectPropMeta, targetClass, context, visited);
                    properties[key] = {
                        ...objectSchema,
                        // don't let an explicit (but absent) meta.description blank out the cycle guard's own message
                        description: meta.description ?? objectSchema.description
                    };
                    continue;
                }
                case RelationType.HAS_ONE:
                case RelationType.BELONGS_TO_ONE:
                case RelationType.MANY_TO_ONE: {
                    // getTargetClassForRelation returns a fresh OmitClass-derived class on every call (used here
                    // only to strip the inverse back-reference key), so it can never match a previously visited
                    // entry in `visited` — cycle tracking must key off the real, stable target class instead.
                    const targetClass: Newable<BaseEntity> = this.getTargetClassForRelation(meta, entity);
                    const objectPropMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetClass);
                    const objectSchema: OpenApiSchemaObject
                        = this.buildOpenApiSchemaForProperties(objectPropMeta, meta.target(), context, visited);
                    properties[key] = {
                        ...objectSchema,
                        description: meta.description ?? objectSchema.description
                    };
                    continue;
                }
                case RelationType.MANY_TO_MANY:
                case RelationType.ONE_TO_MANY: {
                    const targetClass: Newable<BaseEntity> = this.getTargetClassForRelation(meta, entity);
                    const objectPropMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetClass);
                    const itemSchema: OpenApiSchemaObject
                        = this.buildOpenApiSchemaForProperties(objectPropMeta, meta.target(), context, visited);
                    properties[key] = {
                        type: 'array',
                        description: meta.description,
                        items: itemSchema
                    };
                    continue;
                }
                case 'array': {
                    // See the comment on the MANY_TO_MANY/ONE_TO_MANY case above for why this needs a fresh class.
                    const items: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(
                        { items: meta.items },
                        class {},
                        context,
                        visited
                    );
                    properties[key] = {
                        type: 'array',
                        description: meta.description,
                        items: items.properties?.['items']
                    };
                    continue;
                }
                case 'unknown': {
                    properties[key] = {
                        ...meta,
                        type: undefined,
                        required: undefined
                    };
                    continue;
                }
                case 'oneOf': {
                    // exactly one matches, since a value names its shape. Built one shape at a time
                    // through the same fresh-class route arrays take, see there
                    properties[key] = {
                        description: meta.description,
                        oneOf: ObjectUtilities.entries(meta.shapes).map(([name, shape]) => ({
                            type: 'object',
                            properties: {
                                shape: { type: 'string', enum: [name] },
                                value: this.buildOpenApiSchemaForProperties({ shape }, class {}, context, visited)
                                    .properties?.['shape'] ?? {}
                            },
                            required: ['shape', 'value']
                        })),
                        discriminator: { propertyName: 'shape' }
                    };
                    continue;
                }
                default: {
                    throw new InternalError(`Unknown property type "${(meta as PropertyMetadata).type}"`);
                }
            }
        }
        // only the classes above this one make a cycle - a sibling property may describe the same class again
        visited.delete(entity);
        this.annotateXml(properties, entity);

        return {
            type: 'object',
            properties,
            // only include `required` if non-empty
            ...required.length ? { required } : {}
        };
    }

    private getTargetClassForRelation(
        meta: OneToManyPropertyMetadata<BaseEntity>
            | ManyToManyPropertyMetadata<BaseEntity>
            | ManyToOnePropertyMetadata<BaseEntity>
            | BelongsToOnePropertyMetadata<BaseEntity>
            | HasOnePropertyMetadata<BaseEntity>,
        entity: Newable<unknown>
    ): Newable<BaseEntity> {
        const fullTargetClass: Newable<BaseEntity> = meta.target();

        const excludeKeys: (keyof Newable<unknown>)[] = [];
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(fullTargetClass);
        for (const [key, property] of ObjectUtilities.entries(properties)) {
            if (
                property.type !== RelationType.BELONGS_TO_ONE
                && property.type !== RelationType.HAS_ONE
                && property.type !== RelationType.ONE_TO_MANY
                && property.type !== RelationType.MANY_TO_ONE
                && property.type !== RelationType.MANY_TO_MANY
            ) {
                continue;
            }
            if (property.target() === entity) {
                excludeKeys.push(key as keyof Newable<unknown>);
            }
        }

        const targetClass: Newable<BaseEntity> = OmitClass(fullTargetClass, excludeKeys);
        return targetClass;
    }

    private buildParameters(
        params: Record<number, QueryParamMetadata | HeaderParamMetadata | PathParamMetadata>,
        location: OpenApiParameterLocation
    ): OpenApiParameter[] {
        return ObjectUtilities.values(params).map(meta => ({
            name: meta.name,
            in: location,
            required: typeof meta.required === 'boolean' ? meta.required : undefined,
            content: meta.type === 'object'
                ? {
                    [MimeType.JSON]: {
                        schema: this.paramToSchema(meta)
                    }
                }
                : undefined,
            schema: meta.type === 'object' ? undefined : this.paramToSchema(meta),
            description: meta.description
        }));
    }

    /**
     * The schema of a single parameter, or of the items inside an array one.
     *
     * Takes the item metadata as well as the parameter metadata, which is what an array recurses on.
     * The two differ only in that an item has no name of its own, and nothing here reads one.
     * @param meta - The parameter, or the items of an array parameter.
     * @returns Its schema.
     */
    private paramToSchema(
        meta: QueryParamMetadata | PathParamMetadata | HeaderParamMetadata | ArrayParamItemMetadata
    ): OpenApiSchemaObject {
        switch (meta.type) {
            case 'boolean': {
                return this.booleanSchema(meta, undefined);
            }
            case 'number': {
                return this.numberSchema(meta, undefined);
            }
            case 'string': {
                return this.stringSchema(meta, undefined);
            }
            case 'date': {
                return {
                    type: 'string',
                    format: 'date-time',
                    description: meta.description
                };
            }
            case 'object': {
                const propMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(meta.cls());
                return {
                    description: meta.description,
                    ...this.buildOpenApiSchemaForProperties(propMeta, meta.cls(), 'request', new Set())
                };
            }
            case 'array': {
                return {
                    type: 'array',
                    description: meta.description,
                    // the items, not the array itself. Recursing on `meta` never reached a leaf and
                    // ran until the stack gave out
                    items: this.paramToSchema(meta.items)
                };
            }
            case 'oneOf': {
                return this.buildAnyOfSchema(meta.shapes, meta.description, 'request');
            }
        }
    }

    // built from the fields the openapi schema object defines, never by spreading the declaration: a
    // property's metadata also carries what only the framework reads - `encryption`, `hash`,
    // `primary`, `index` - and a parameter's carries its own name, none of which belong in a document
    // the framework publishes
    private stringSchema(meta: StringSchemaSource, defaultValue: unknown): OpenApiSchemaObject {
        return {
            type: 'string',
            format: meta.format,
            description: meta.description,
            minLength: meta.minLength,
            maxLength: meta.maxLength,
            // the pattern without its delimiters and flags: `/^[a-z]+$/` written as it is would ask
            // a client for the slashes as well
            pattern: meta.regex instanceof RegExp ? meta.regex.source : meta.regex,
            enum: meta.enum ? ObjectUtilities.values(meta.enum) : undefined,
            ...this.defaultSchemaValue(defaultValue)
        };
    }

    private numberSchema(meta: NumberSchemaSource, defaultValue: unknown): OpenApiSchemaObject {
        return {
            ...this.openApiNumberType(meta.format),
            description: meta.description,
            minimum: meta.min,
            maximum: meta.max,
            enum: meta.enum ? ObjectUtilities.values(meta.enum) : undefined,
            ...this.defaultSchemaValue(defaultValue)
        };
    }

    private booleanSchema(meta: BooleanSchemaSource, defaultValue: unknown): OpenApiSchemaObject {
        return { type: 'boolean', description: meta.description, ...this.defaultSchemaValue(defaultValue) };
    }

    // a default computed per request is a function, and a document can only state a value
    private defaultSchemaValue(defaultValue: unknown): Pick<OpenApiSchemaObject, 'default'> {
        return defaultValue == undefined || typeof defaultValue === 'function' ? {} : { default: defaultValue };
    }

    private openApiNumberType(format: NumberFormat): OpenApiNumberType {
        switch (format) {
            case 'number': {
                return { type: 'number', format: 'double' };
            }
            case 'integer': {
                return { type: 'integer', format: 'int64' };
            }
            case 'bigint': {
                return { type: 'string', format: 'int64' };
            }
            case 'bignumber': {
                return { type: 'string', format: 'decimal' };
            }
        }
    }
}