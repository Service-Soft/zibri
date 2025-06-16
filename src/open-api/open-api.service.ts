import path from 'path';

import { ContentObject, ParameterLocation, ResponseObject, ResponsesObject, TagObject } from 'openapi3-ts/dist/oas31';
import swaggerUi from 'swagger-ui-express';

import { ZibriApplication } from '../application';
import { AssetServiceInterface } from '../assets';
import { AuthServiceInterface, BelongsToMetadata, HasRoleMetadata, IsLoggedInMetadata } from '../auth';
import { inject, ZIBRI_DI_TOKENS } from '../di';
import { BaseEntity, ManyToManyPropertyMetadata, ManyToOnePropertyMetadata, OmitType, OneToManyPropertyMetadata, OneToOnePropertyMetadata, PropertyMetadata, Relation } from '../entity';
import { GlobalRegistry } from '../global';
import { HttpRequest, HttpResponse, HttpStatus, MimeType } from '../http';
import { LoggerInterface } from '../logging';
import { BodyMetadata, ControllerRouteConfiguration, HeaderParamMetadata, PathParamMetadata, QueryParamMetadata, Route } from '../routing';
import { OpenApiServiceInterface } from './open-api-service.interface';
import { OpenApiDefinition, OpenApiOperation, OpenApiParameter, OpenApiPaths, OpenApiRequestBodyObject, OpenApiResponse, OpenApiSchemaObject, OpenApiSecurityRequirementObject, OpenApiSecuritySchemeObject } from './open-api.model';
import { MissingBaseRouteError } from '../routing/missing-base-route.error';
import { Newable } from '../types';
import { MetadataUtilities } from '../utilities';

const defaultDescriptionForHttpStatus: Record<HttpStatus | 'default', string> = {
    default: 'Response',
    [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
    [HttpStatus.NOT_FOUND_ERROR]: 'Not Found',
    [HttpStatus.BAD_REQUEST]: 'Bad Request',
    [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
    [HttpStatus.FORBIDDEN]: 'Forbidden',
    [HttpStatus.OK]: 'Ok',
    [HttpStatus.CREATED]: 'Created'
};

export class OpenApiService implements OpenApiServiceInterface {
    readonly openApiRoute: Route = '/explorer';
    private readonly logger: LoggerInterface;
    private readonly assetService: AssetServiceInterface;
    private readonly authService: AuthServiceInterface;

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
        this.assetService = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
        this.authService = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    }

    attachTo(app: ZibriApplication): void {
        const definition: OpenApiDefinition = this.createOpenApiDefinition();
        this.logger.info('registers the OpenAPI Explorer at', this.openApiRoute);

        app.express.get(`${this.openApiRoute}/swagger-ui.css`, (_req: HttpRequest, res: HttpResponse) => {
            const filePath: string = path.join(this.assetService.assetsPath, 'open-api', 'swagger-ui.css');
            res.sendFile(filePath);
        });
        app.express.get(`${this.openApiRoute}/swagger-ui-bundle.js`, (_req: HttpRequest, res: HttpResponse) => {
            const filePath: string = path.join(this.assetService.assetsPath, 'open-api', 'swagger-ui-bundle.js');
            res.sendFile(filePath);
        });
        app.express.get(`${this.openApiRoute}/swagger-ui-standalone-preset.js`, (_req: HttpRequest, res: HttpResponse) => {
            const filePath: string = path.join(this.assetService.assetsPath, 'open-api', 'swagger-ui-standalone-preset.js');
            res.sendFile(filePath);
        });
        app.express.get(`${this.openApiRoute}/swagger-ui-init.js`, (_req: HttpRequest, res: HttpResponse) => {
            res.type('.js').send([
                'window.onload = function() {',
                '    SwaggerUIBundle({',
                `        spec: ${JSON.stringify(definition)},`,
                '        dom_id: \'#swagger-ui\',',
                '        presets: [',
                '            SwaggerUIBundle.presets.apis,',
                '            SwaggerUIStandalonePreset',
                '        ],',
                '        layout: "StandaloneLayout"',
                '    });',
                '};'

            ].join('\n'));
        });

        app.express.use(this.openApiRoute, swaggerUi.serve);
        app.express.get(
            this.openApiRoute,
            swaggerUi.setup(
                definition,
                {
                    // eslint-disable-next-line cspell/spellchecker
                    customfavIcon: `${this.assetService.assetsRoute}/favicon.png`,
                    customSiteTitle: definition.info.title,
                    customCssUrl: `${this.assetService.assetsRoute}/open-api/custom.css`,
                    swaggerOptions: {
                        requestInterceptor: (req: HttpRequest) => {
                            req.headers.Accept = MimeType.JSON;
                            req.headers['Content-Type'] = MimeType.JSON;
                            return req;
                        },
                        // Ensure Swagger UI doesn't add format suffixes
                        defaultModelRendering: 'model'
                    }
                }
            )
        );
    }

    createOpenApiDefinition(): OpenApiDefinition {
        const tags: TagObject[] = GlobalRegistry.controllerClasses.map(cls => ({ name: cls.name }));
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
            paths: this.resolveOpenApiPaths()
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

    private resolveOpenApiPaths(): OpenApiPaths {
        const res: OpenApiPaths = {};

        for (const controllerClass of GlobalRegistry.controllerClasses) {
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

                const hasRoleMetadata: HasRoleMetadata | undefined = this.authService.resolveHasRoleMetadata(
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
                    security: this.resolveOperationSecurity(controllerClass, route.controllerMethod),
                    ['x-roles']: hasRoleMetadata?.allowedRoles
                };
                res[fullPath][route.httpMethod] = operation;
            }
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

    private buildResponseContent(response: OpenApiResponse): ContentObject | undefined {
        if (response.type === 'file') {
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

    private buildResponsesContent(responses: OpenApiResponse[]): ContentObject | undefined {
        const schemas: OpenApiSchemaObject[] = [];
        for (const response of responses) {
            if (response.type === 'file') {
                schemas.push({ type: 'string', format: 'binary' });
                continue;
            }
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

        return { [MimeType.JSON]: { schema: { oneOf: schemas } } };
    }

    private resolveOperationSecurity(
        controllerClass: Newable<Object>,
        controllerMethod: string
    ): OpenApiSecurityRequirementObject[] | undefined {
        const res: OpenApiSecurityRequirementObject[] = [];
        const isLoggedInMetadata: IsLoggedInMetadata | undefined = this.authService.resolveIsLoggedInMetadata(
            controllerClass,
            controllerMethod
        );
        const hasRoleMetadata: HasRoleMetadata | undefined = this.authService.resolveHasRoleMetadata(
            controllerClass,
            controllerMethod
        );
        const belongsToMetadata: BelongsToMetadata<Newable<BaseEntity>> | undefined = this.authService.resolveBelongsToMetadata(
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
            required: metadata.required,
            description: metadata.description,
            content: { [metadata.type]: { schema } }
        };
    }

    private buildOpenApiSchemaForProperties(propMeta: Record<string, PropertyMetadata>, entity: Newable<unknown>): OpenApiSchemaObject {
        const properties: Record<string, OpenApiSchemaObject> = {};
        const required: string[] = [];

        for (const [key, meta] of Object.entries(propMeta)) {
            // mark required
            if ('required' in meta && meta.required) {
                required.push(key);
            }
            switch (meta.type) {
                case 'date': {
                    properties[key] = { type: 'string', format: 'date-time', description: meta.description };
                    continue;
                }
                case 'number':
                case 'boolean': {
                    properties[key] = { type: meta.type, description: meta.description };
                    continue;
                }
                case 'file': {
                    properties[key] = { type: 'string', format: 'binary', description: meta.description };
                    continue;
                }
                case 'string': {
                    properties[key] = {
                        type: meta.type,
                        format: meta.format,
                        description: meta.description,
                        minLength: meta.minLength,
                        maxLength: meta.maxLength
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
                                description: undefined
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

        const targetClass: Newable<BaseEntity> = OmitType(fullTargetClass, excludeKeys);
        return targetClass;
    }

    private buildParameters(
        queryParams: Record<number, QueryParamMetadata | HeaderParamMetadata | PathParamMetadata>,
        location: ParameterLocation
    ): OpenApiParameter[] {
        return Object.values(queryParams).map(meta => ({
            name: meta.name,
            in: location,
            required: meta.required,
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
            case 'boolean':
            case 'number': {
                return {
                    type: meta.type,
                    description: meta.description
                };
            }
            case 'string': {
                return {
                    type: meta.type,
                    format: meta.format,
                    description: meta.description
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