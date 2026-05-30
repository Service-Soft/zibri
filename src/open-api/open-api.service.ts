import { Readable } from 'node:stream';

import { ZibriApplication } from '../application';
import { OpenApiServiceInterface } from './open-api-service.interface';
import { OpenApiDefinition, OpenApiTagObject, OpenApiSecuritySchemeObject, OpenApiPaths, OpenApiResponse, OpenApiOperation, OpenApiResponsesObject, OpenApiResponseObject, OpenApiContentObject, OpenApiSchemaObject, OpenApiSecurityRequirementObject, OpenApiRequestBodyObject, OpenApiParameterLocation, OpenApiParameter } from './open-api.model';
import { type AssetServiceInterface } from '../assets/asset-service.interface';
import { type AuthServiceInterface } from '../auth/auth-service.interface';
import { BelongsToMetadata } from '../auth/models/belongs-to-metadata.model';
import { HasRoleMetadata } from '../auth/models/has-role-metadata.model';
import { IsLoggedInMetadata } from '../auth/models/is-logged-in-metadata.model';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { BelongsToOnePropertyMetadata } from '../entity/models/belongs-to-one-property-metadata.model';
import { HasOnePropertyMetadata } from '../entity/models/has-one-property-metadata.model';
import { ManyToManyPropertyMetadata } from '../entity/models/many-to-many-property-metadata.model';
import { ManyToOnePropertyMetadata } from '../entity/models/many-to-one-property-metadata.model';
import { OneToManyPropertyMetadata } from '../entity/models/one-to-many-property-metadata.model';
import { Relation } from '../entity/models/relation.enum';
import { OmitClass } from '../entity/omit-class.model';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { GlobalRegistry } from '../global/global-registry';
import { OnAppInit } from '../global/on-app-init.interface';
import { HttpMethod } from '../http/http-method.enum';
import { HttpStatus } from '../http/http-status.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { FormatDateFn } from '../localization/formatting/format-date-fn.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { FileResponse } from '../parsing/form-data/file-response.model';
import { HtmlResponse } from '../parsing/html/html-response.model';
import { Route, ControllerRouteConfiguration } from '../routing/controller-route-configuration.model';
import { BodyMetadata } from '../routing/decorators/body.decorator';
import { ControllerData } from '../routing/decorators/controller.decorator';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata } from '../routing/decorators/param.decorator';
import { MissingBaseRouteError } from '../routing/missing-base-route.error';
import { type RouterInterface } from '../routing/router.interface';
import { Newable } from '../types/newable.type';
import { FsUtilities, FsPath } from '../utilities/fs.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { SemVerUtilities } from '../utilities/sem-ver.utilities';
import { SupportedVersionsOptions } from '../versioning/supported-versions-options.model';
import { Version, VersionFile } from '../versioning/version.model';
import { type VersioningServiceInterface } from '../versioning/versioning-service.interface';

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
    [HttpStatus.CONFLICT]: '',
    [HttpStatus.GONE]: '',
    [HttpStatus.CONTENT_TOO_LARGE]: '',
    [HttpStatus.URI_TOO_LONG]: '',
    [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: '',
    [HttpStatus.UNPROCESSABLE_ENTITY]: '',
    [HttpStatus.NOT_IMPLEMENTED]: '',
    [HttpStatus.BAD_GATEWAY]: '',
    [HttpStatus.SERVICE_UNAVAILABLE]: '',
    [HttpStatus.GATEWAY_TIMEOUT]: '',
    [HttpStatus.HTTP_VERSION_NOT_SUPPORTED]: ''
};

/**
 * Default open api service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class OpenApiService implements OpenApiServiceInterface, OnAppInit {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly openApiRoute: Route = '/explorer';

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
        private readonly versioningService: VersioningServiceInterface
    ) { }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        await this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/spec/:version`,
            versions: 'all',
            openApi: { useInOpenApi: false },
            pathParams: { version: { type: 'string' } },
            handler: async (req) => {
                const versionValue: string = req.params['version'];
                const versions: VersionFile[] = this.versioningService.getVersions();
                const version: VersionFile | undefined = versions.find(v => v.value === versionValue);
                if (!version) {
                    throw new NotFoundError(`Version "${versionValue}" not found`);
                }
                return await this.createOpenApiDefinition(app, version);
            }
        });

        await this.logger.info(`registers the OpenAPI Explorer at ${this.openApiRoute}`);

        await this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/swagger-ui.css`,
            versions: 'all',
            openApi: { useInOpenApi: false },
            handler: () => {
                const filePath: FsPath = FsUtilities.getPath(this.assetService.publicAssetsPath, 'open-api', 'swagger-ui.css');
                return FileResponse.fromPath(filePath);
            }
        });
        await this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/swagger-ui-bundle.js`,
            versions: 'all',
            openApi: { useInOpenApi: false },
            handler: () => {
                const filePath: FsPath = FsUtilities.getPath(this.assetService.publicAssetsPath, 'open-api', 'swagger-ui-bundle.js');
                return FileResponse.fromPath(filePath);
            }
        });
        await this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/swagger-ui-standalone-preset.js`,
            versions: 'all',
            openApi: { useInOpenApi: false },
            handler: () => {
                const filePath: FsPath = FsUtilities.getPath(
                    this.assetService.publicAssetsPath,
                    'open-api',
                    'swagger-ui-standalone-preset.js'
                );
                return FileResponse.fromPath(filePath);
            }
        });
        await this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/swagger-ui-init.js`,
            versions: 'all',
            openApi: { useInOpenApi: false },
            handler: () => {
                const formatDate: FormatDateFn = inject(ZIBRI_DI_TOKENS.FORMAT_DATE);
                const versions: VersionFile[] = this.versioningService
                    .getVersions()
                    .sort((a, b) => SemVerUtilities.compare(a.value, b.value) === 'bigger' ? -1 : 1);
                // eslint-disable-next-line jsdoc/require-jsdoc
                const urls: { url: string, name: string }[] = versions.map(v => ({
                    url: `${this.openApiRoute}/spec/${v.value}`,
                    name: v.endsAt == undefined
                        ? `${v.value} (latest)`
                        : `${v.value} (${formatDate(v.startsAt)} - ${formatDate(v.endsAt)})`
                }));
                const latestVersion: VersionFile | undefined = versions.find(v => v.endsAt == undefined);
                return FileResponse.fromStream({
                    filename: 'swagger-ui-init.js',
                    mimeType: MimeType.JAVASCRIPT,
                    stream: Readable.from([
                        [
                            'window.onload = function() {',
                            '    window.ui = SwaggerUIBundle({',
                            `        urls: ${JSON.stringify(urls)},`,
                            `        "urls.primaryName": "${latestVersion?.value ?? ''}",`,
                            '        dom_id: \'#swagger-ui\',',
                            '        presets: [',
                            '            SwaggerUIBundle.presets.apis,',
                            '            SwaggerUIStandalonePreset',
                            '        ],',
                            '        layout: "StandaloneLayout",',
                            '        requestInterceptor: (req) => {',
                            '            req.headers.Accept = \'application/json\'',
                            `            req.headers['${KnownHeader.CONTENT_TYPE}'] = \'application/json\'`,
                            '            return req;',
                            '        },',
                            '        defaultModelRendering: \'model\'',
                            '    });',
                            '};'
                        ].join('\n')
                    ])
                });
            }
        });

        await this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/custom.js`,
            versions: 'all',
            openApi: { useInOpenApi: false },
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
                            // eslint-disable-next-line cspell/spellchecker
                            '            const opBlocks = document.querySelectorAll(\'.opblock\');',
                            '            opBlocks.forEach((op) => {',
                            '                try {',
                            // eslint-disable-next-line cspell/spellchecker
                            '                    const methodEl = op.querySelector(\'.opblock-summary-method\');',
                            // eslint-disable-next-line cspell/spellchecker
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
                            // eslint-disable-next-line cspell/spellchecker
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

        await this.router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: this.openApiRoute,
            versions: 'all',
            openApi: { useInOpenApi: false },
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

    // eslint-disable-next-line jsdoc/require-jsdoc
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

                const hasRoleMetadata: HasRoleMetadata | undefined = await this.authService.resolveHasRoleMetadata(
                    controllerClass,
                    route.controllerMethod
                );

                const operation: OpenApiOperation = {
                    responses: this.buildResponses(responses),
                    tags: [controllerClass.name],
                    parameters: [
                        ...this.buildParameters(pathParams, 'path'),
                        ...this.buildParameters(queryParams, 'query'),
                        ...this.buildParameters(headerParams, 'header')
                    ],
                    requestBody: this.buildOpenApiBody(bodyMetadata),
                    security: await this.resolveOperationSecurity(controllerClass, route.controllerMethod),
                    ['x-roles']: hasRoleMetadata?.allowedRoles
                };
                res[fullPath][route.httpMethod] = operation;
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
                throw new Error(`Invalid open api configuration on route ${route.route}`);
            }

            const operation: OpenApiOperation = {
                responses: this.buildResponses(route.openApi.responses),
                tags: route.openApi.tags,
                parameters: [
                    ...this.buildParameters(route.pathParams, 'path'),
                    ...this.buildParameters(route.queryParams, 'query'),
                    ...this.buildParameters(route.headerParams, 'header')
                ],
                requestBody: this.buildOpenApiBody(route.bodyMetadata)
                // security: this.resolveOperationSecurity(controllerClass, route.controllerMethod),
                // ['x-roles']: hasRoleMetadata?.allowedRoles
            };
            res[fullPath][route.httpMethod] = operation;
        }

        return res;
    }

    private buildResponses(responses: OpenApiResponse[]): OpenApiResponsesObject | undefined {
        const res: OpenApiResponsesObject = {};

        const groupedResponses: Record<string, OpenApiResponse[]> = {};
        for (const response of responses) {
            if (groupedResponses[response.status ?? 'default'] != undefined) {
                groupedResponses[response.status ?? 'default'].push(response);
            }
            else {
                groupedResponses[response.status ?? 'default'] = [response];
            }
        }

        for (const status in groupedResponses) {
            const r: OpenApiResponse[] = groupedResponses[status];
            if (r.length > 1) {
                const data: OpenApiResponseObject = {
                    description: '',
                    content: this.buildResponsesContent(r)
                };
                res[status] = data;
            }
            else {
                const response: OpenApiResponse = r[0];
                const data: OpenApiResponseObject = {
                    description: response.description ?? defaultDescriptionForHttpStatus[response.status ?? 'default'],
                    content: this.buildResponseContent(response)
                };
                res[status] = data;
            }
        }

        return res;
    }

    // eslint-disable-next-line sonar/cognitive-complexity
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
                if (!response.cls) {
                    return undefined;
                }
                const propMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(response.cls);
                const schema: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(propMeta, response.cls, 'response', new Set());

                if (response.isArray === true) {
                    return { [MimeType.JSON]: { schema: { type: 'array', items: schema } } };
                }

                return { [MimeType.JSON]: { schema } };
            }
            case 'html': {
                const schema: OpenApiSchemaObject = {
                    type: 'string',
                    format: 'html'
                };
                return { [MimeType.HTML]: { schema } };
            }
            case 'error': {
                return undefined;
            }
            default: {
                throw new Error(`Unknown response type ${(response as OpenApiResponse).type}`);
            }
        }

    }

    private buildResponsesContent(responses: OpenApiResponse[]): OpenApiContentObject | undefined {
        const schemas: OpenApiSchemaObject[] = [];
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
                    if (!response.cls) {
                        continue;
                    }
                    const propMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(response.cls);
                    const schema: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(propMeta, response.cls, 'response', new Set());
                    if (response.isArray === true) {
                        schemas.push({ type: 'array', items: schema });
                        continue;
                    }
                    schemas.push(schema);
                }
                case 'error': {
                    continue;
                }
                default: {
                    throw new Error(`Unknown response type ${(response as OpenApiResponse).type}`);
                }
            }

        }

        return { [MimeType.JSON]: { schema: { oneOf: schemas } } };
    }

    private async resolveOperationSecurity(
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ): Promise<OpenApiSecurityRequirementObject[] | undefined> {
        const res: OpenApiSecurityRequirementObject[] = [];
        const isLoggedInMetadata: IsLoggedInMetadata | undefined = await this.authService.resolveIsLoggedInMetadata(
            controllerClass,
            controllerMethod
        );
        const hasRoleMetadata: HasRoleMetadata | undefined = await this.authService.resolveHasRoleMetadata(
            controllerClass,
            controllerMethod
        );
        const belongsToMetadata: BelongsToMetadata<Newable<BaseEntity>> | undefined = await this.authService.resolveBelongsToMetadata(
            controllerClass,
            controllerMethod
        );

        if (!isLoggedInMetadata && !hasRoleMetadata && !belongsToMetadata) {
            return undefined;
        }

        for (const strategy of this.authService.strategies.map(s => inject(s))) {
            res.push({ [strategy.name]: [] });
        }
        return res;
    }

    private buildOpenApiBody(metadata: BodyMetadata | undefined): OpenApiRequestBodyObject | undefined {
        if (!metadata) {
            return undefined;
        }
        const propMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(metadata.modelClass);
        const schema: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(propMeta, metadata.modelClass, 'request', new Set());
        return {
            required: typeof metadata.required === 'boolean' ? metadata.required : undefined,
            description: metadata.description,
            content: { [metadata.type]: { schema } }
        };
    }

    // eslint-disable-next-line sonar/cognitive-complexity
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
                    properties[key] = {
                        ...meta,
                        required: undefined,
                        minimum: meta.min,
                        maximum: meta.max,
                        enum: meta.enum ? ObjectUtilities.values(meta.enum) : undefined
                    };
                    continue;
                }
                case 'boolean': {
                    properties[key] = { ...meta, required: undefined };
                    continue;
                }
                case 'file': {
                    properties[key] = { type: 'string', format: 'binary', description: meta.description };
                    continue;
                }
                case 'string': {
                    properties[key] = {
                        ...meta,
                        required: undefined,
                        pattern: meta.regex?.toString(),
                        enum: meta.enum ? ObjectUtilities.values(meta.enum) : undefined
                    };
                    continue;
                }
                case 'object': {
                    const objectPropMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(meta.cls());
                    properties[key] = {
                        ...this.buildOpenApiSchemaForProperties(objectPropMeta, entity, context, visited),
                        description: meta.description
                    };
                    continue;
                }
                case Relation.HAS_ONE:
                case Relation.BELONGS_TO_ONE:
                case Relation.MANY_TO_ONE: {
                    const targetClass: Newable<BaseEntity> = this.getTargetClassForRelation(meta, entity);
                    const objectPropMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetClass);
                    properties[key] = {
                        ...this.buildOpenApiSchemaForProperties(objectPropMeta, entity, context, visited),
                        description: meta.description
                    };
                    continue;
                }
                case Relation.MANY_TO_MANY:
                case Relation.ONE_TO_MANY: {
                    const targetClass: Newable<BaseEntity> = this.getTargetClassForRelation(meta, entity);

                    const items: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(
                        {
                            items: {
                                type: 'object',
                                cls: () => targetClass,
                                required: true,
                                description: undefined,
                                excludeFromChangeSets: false,
                                exclude: false,
                                allowAdditionalProperties: false
                            }
                        },
                        entity,
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
                case 'array': {
                    if (meta.items.type === 'object') {
                        entity = meta.items.cls();
                    }
                    const items: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(
                        { items: meta.items },
                        entity,
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
                default: {
                    throw new Error(`Unknown property type "${(meta as PropertyMetadata).type}"`);
                }
            }
        }

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
        for (const key in properties) {
            const property: PropertyMetadata = properties[key];
            if (
                property.type !== Relation.BELONGS_TO_ONE
                && property.type !== Relation.HAS_ONE
                && property.type !== Relation.ONE_TO_MANY
                && property.type !== Relation.MANY_TO_ONE
                && property.type !== Relation.MANY_TO_MANY
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

    private paramToSchema(meta: QueryParamMetadata | PathParamMetadata | HeaderParamMetadata): OpenApiSchemaObject {
        switch (meta.type) {
            case 'boolean': {
                return { ...meta, required: undefined };
            }
            case 'number': {
                return {
                    ...meta,
                    required: undefined,
                    minimum: meta.min,
                    maximum: meta.max,
                    enum: meta.enum ? ObjectUtilities.values(meta.enum) : undefined
                };
            }
            case 'string': {
                return {
                    ...meta,
                    required: undefined,
                    pattern: meta.regex?.toString(),
                    enum: meta.enum ? ObjectUtilities.values(meta.enum) : undefined
                };
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
                    items: this.paramToSchema(meta)
                };
            }
        }
    }
}