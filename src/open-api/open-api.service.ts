import path from 'path';

import { ContentObject, ParameterLocation, ResponseObject, ResponsesObject, TagObject } from 'openapi3-ts/oas31';
import swaggerUi from 'swagger-ui-express';

import { ZibriApplication } from '../application';
import { AssetServiceInterface } from '../assets';
import { AuthServiceInterface, BelongsToMetadata, HasRoleMetadata, IsLoggedInMetadata } from '../auth';
import { inject, ZIBRI_DI_TOKENS } from '../di';
import { BaseEntity, ManyToManyPropertyMetadata, ManyToOnePropertyMetadata, OmitClass, OneToManyPropertyMetadata, OneToOnePropertyMetadata, PropertyMetadata, Relation } from '../entity';
import { GlobalRegistry } from '../global';
import { HttpMethod, HttpStatus, MimeType } from '../http';
import { LoggerInterface } from '../logging';
import { BodyMetadata, ControllerRouteConfiguration, HeaderParamMetadata, PathParamMetadata, QueryParamMetadata, Route, RouteHandler } from '../routing';
import { OpenApiServiceInterface } from './open-api-service.interface';
import { OpenApiDefinition, OpenApiOperation, OpenApiParameter, OpenApiPaths, OpenApiRequestBodyObject, OpenApiResponse, OpenApiSchemaObject, OpenApiSecurityRequirementObject, OpenApiSecuritySchemeObject } from './open-api.model';
import { FileResponse } from '../parsing';
import { MissingBaseRouteError } from '../routing/missing-base-route.error';
import { Newable } from '../types';
import { MetadataUtilities } from '../utilities';

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
    [HttpStatus.PAYLOAD_TOO_LARGE]: '',
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
export class OpenApiService implements OpenApiServiceInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly openApiRoute: Route = '/explorer';
    private readonly logger: LoggerInterface;
    private readonly assetService: AssetServiceInterface;
    private readonly authService: AuthServiceInterface;

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
        this.assetService = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
        this.authService = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async attachTo(app: ZibriApplication): Promise<void> {
        const definition: OpenApiDefinition = await this.createOpenApiDefinition(app);
        await this.logger.info(`registers the OpenAPI Explorer at ${this.openApiRoute}`);

        await app.router.register({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/swagger-ui.css`,
            handler: () => {
                const filePath: string = path.join(this.assetService.publicAssetsPath, 'open-api', 'swagger-ui.css');
                return FileResponse.fromPath(filePath);
            }
        });
        await app.router.register({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/swagger-ui-bundle.js`,
            handler: () => {
                const filePath: string = path.join(this.assetService.publicAssetsPath, 'open-api', 'swagger-ui-bundle.js');
                return FileResponse.fromPath(filePath);
            }
        });
        await app.router.register({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/swagger-ui-standalone-preset.js`,
            handler: () => {
                const filePath: string = path.join(this.assetService.publicAssetsPath, 'open-api', 'swagger-ui-standalone-preset.js');
                return FileResponse.fromPath(filePath);
            }
        });
        await app.router.register({
            httpMethod: HttpMethod.GET,
            route: `${this.openApiRoute}/swagger-ui-init.js`,
            handler: (_, res) => {
                res.type('.js').send([
                    'window.onload = function() {',
                    '    SwaggerUIBundle({',
                    `        spec: ${JSON.stringify(definition)},`,
                    '        dom_id: \'#swagger-ui\',',
                    '        presets: [',
                    '            SwaggerUIBundle.presets.apis,',
                    '            SwaggerUIStandalonePreset',
                    '        ],',
                    '        layout: "StandaloneLayout",',
                    '        requestInterceptor: (req) => {',
                    '            req.headers.Accept = \'application/json\'',
                    '            req.headers[\'Content-Type\'] = \'application/json\'',
                    '            return req;',
                    '        },',
                    '        defaultModelRendering: \'model\'',
                    '    });',
                    '};'

                ].join('\n'));
            }
        });

        app.use(this.openApiRoute, swaggerUi.serve);
        await app.router.register({
            httpMethod: HttpMethod.GET,
            route: this.openApiRoute,
            handler: swaggerUi.setup(
                definition,
                {
                // eslint-disable-next-line cspell/spellchecker
                    customfavIcon: `${this.assetService.assetsRoute}/favicon.png`,
                    customSiteTitle: definition.info.title,
                    customCssUrl: `${this.assetService.assetsRoute}/open-api/custom.css`
                }
            ) as RouteHandler<BodyMetadata, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createOpenApiDefinition(app: ZibriApplication): Promise<OpenApiDefinition> {
        const tags: TagObject[] = app.options.controllers.map(cls => ({ name: cls.name }));
        const res: OpenApiDefinition = {
            openapi: '3.1.0',
            info: {
                title: `${GlobalRegistry.getAppData('name')} | Explorer`,
                version: GlobalRegistry.getAppData('version') ?? '0.0.0'
            },
            tags,
            components: {
                securitySchemes: this.resolveSecuritySchemes()
            },
            paths: await this.resolveOpenApiPaths(app)
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

    private async resolveOpenApiPaths(app: ZibriApplication): Promise<OpenApiPaths> {
        const res: OpenApiPaths = {};

        for (const controllerClass of app.options.controllers) {
            const baseRoute: Route | undefined = MetadataUtilities.getControllerBaseRoute(controllerClass);
            if (!baseRoute) {
                throw new MissingBaseRouteError(controllerClass);
            }

            const routes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(controllerClass);
            for (const route of routes) {
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
                const fullPath: string = `${baseRoute}${route.route}`.replaceAll(/:([^/]+)/g, '{$1}');
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

        for (const route of app.router.manuallyRegisteredRoutes.filter(r => r.openApi.useInOpenApi)) {
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

    private buildResponses(responses: OpenApiResponse[]): ResponsesObject | undefined {
        const res: ResponsesObject = {};

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
                const data: ResponseObject = {
                    description: '',
                    content: this.buildResponsesContent(r)
                };
                res[status] = data;
            }
            else {
                const response: OpenApiResponse = r[0];
                const data: ResponseObject = {
                    description: response.description ?? defaultDescriptionForHttpStatus[response.status ?? 'default'],
                    content: this.buildResponseContent(response)
                };
                res[status] = data;
            }
        }

        return res;
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private buildResponseContent(response: OpenApiResponse): ContentObject | undefined {
        switch (response.type) {
            case 'file': {
                const schema: OpenApiSchemaObject = { type: 'string', format: 'binary' };
                // normalize mimeType into an array; default to octet‑stream
                const mimeTypes: MimeType[] = Array.isArray(response.mimeType)
                    ? response.mimeType
                    : response.mimeType != undefined
                        ? [response.mimeType === 'all' ? MimeType.OCTET_STREAM : response.mimeType]
                        : [MimeType.OCTET_STREAM];

                const content: ContentObject = {};
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
                const schema: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(propMeta, response.cls);

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

    private buildResponsesContent(responses: OpenApiResponse[]): ContentObject | undefined {
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
                    const schema: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(propMeta, response.cls);
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
        const schema: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(propMeta, metadata.modelClass);
        return {
            required: typeof metadata.required === 'boolean' ? metadata.required : undefined,
            description: metadata.description,
            content: { [metadata.type]: { schema } }
        };
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private buildOpenApiSchemaForProperties(propMeta: Record<string, PropertyMetadata>, entity: Newable<unknown>): OpenApiSchemaObject {
        const properties: Record<string, OpenApiSchemaObject> = {};
        const required: string[] = [];

        for (const [key, meta] of Object.entries(propMeta)) {
            // mark required
            if ((
                typeof meta.required === 'boolean'
                    ? meta.required
                    : false)
                && (!('default' in meta) || meta.default == undefined)
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
                        enum: meta.enum ? Object.values(meta.enum) : undefined
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
                        enum: meta.enum ? Object.values(meta.enum) : undefined
                    };
                    continue;
                }
                case 'object': {
                    const objectPropMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(meta.cls());
                    properties[key] = { ...this.buildOpenApiSchemaForProperties(objectPropMeta, entity), description: meta.description };
                    continue;
                }
                case Relation.ONE_TO_ONE:
                case Relation.MANY_TO_ONE: {
                    const targetClass: Newable<BaseEntity> = this.getTargetClassForRelation(meta, entity);
                    const objectPropMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetClass);
                    properties[key] = { ...this.buildOpenApiSchemaForProperties(objectPropMeta, entity), description: meta.description };
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
                                allowAdditionalProperties: false
                            }
                        },
                        entity
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
                    const items: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties({ items: meta.items }, entity);
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
            | OneToOnePropertyMetadata<BaseEntity>,
        entity: Newable<unknown>
    ): Newable<BaseEntity> {
        const fullTargetClass: Newable<BaseEntity> = meta.target();

        const excludeKeys: (keyof Newable<unknown>)[] = [];
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(fullTargetClass);
        for (const key in properties) {
            const property: PropertyMetadata = properties[key];
            if (
                property.type !== Relation.ONE_TO_ONE
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
        location: ParameterLocation
    ): OpenApiParameter[] {
        return Object.values(params).map(meta => ({
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
                    enum: meta.enum ? Object.values(meta.enum) : undefined
                };
            }
            case 'string': {
                return {
                    ...meta,
                    required: undefined,
                    pattern: meta.regex?.toString(),
                    enum: meta.enum ? Object.values(meta.enum) : undefined
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
                    ...this.buildOpenApiSchemaForProperties(propMeta, meta.cls())
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