import path from 'path';

import { Request, Response } from 'express';
import { ParameterLocation, TagObject } from 'openapi3-ts/dist/oas31';
import swaggerUi from 'swagger-ui-express';

import { ZibriApplication } from '../application';
import { AssetServiceInterface } from '../assets';
import { inject, ZIBRI_DI_TOKENS } from '../di';
import { PropertyMetadata, Relation } from '../entity';
import { GlobalRegistry } from '../global';
import { MimeType } from '../http';
import { LoggerInterface } from '../logging';
import { BodyMetadata, ControllerRouteConfiguration, HeaderParamMetadata, PathParamMetadata, QueryParamMetadata, Route } from '../routing';
import { OpenApiServiceInterface } from './open-api-service.interface';
import { OpenApiDefinition, OpenApiOperation, OpenApiParameter, OpenApiPaths, OpenApiRequestBodyObject, OpenApiSchemaObject } from './open-api.model';
import { MissingBaseRouteError } from '../routing/missing-base-route.error';
import { MetadataUtilities } from '../utilities';

export class OpenApiService implements OpenApiServiceInterface {
    readonly openApiRoute: Route = '/explorer';
    private readonly logger: LoggerInterface;
    private readonly assetService: AssetServiceInterface;

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
        this.assetService = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
    }

    attachTo(app: ZibriApplication): void {
        const definition: OpenApiDefinition = this.createOpenApiDefinition();
        this.logger.info('registers the OpenAPI Explorer at', this.openApiRoute);

        app.express.get(`${this.openApiRoute}/swagger-ui.css`, (_req: Request, res: Response) => {
            const filePath: string = path.join(this.assetService.assetsPath, 'open-api', 'swagger-ui.css');
            res.sendFile(filePath);
        });
        app.express.get(`${this.openApiRoute}/swagger-ui-bundle.js`, (_req: Request, res: Response) => {
            const filePath: string = path.join(this.assetService.assetsPath, 'open-api', 'swagger-ui-bundle.js');
            res.sendFile(filePath);
        });
        app.express.get(`${this.openApiRoute}/swagger-ui-standalone-preset.js`, (_req: Request, res: Response) => {
            const filePath: string = path.join(this.assetService.assetsPath, 'open-api', 'swagger-ui-standalone-preset.js');
            res.sendFile(filePath);
        });
        app.express.get(`${this.openApiRoute}/swagger-ui-init.js`, (_req: Request, res: Response) => {
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
                        requestInterceptor: (req: Request) => {
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
                version: '1.0.0'
            },
            tags,
            paths: this.resolveOpenApiPaths()
        };
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
                const operation: OpenApiOperation = {
                    responses: {},
                    tags: [controllerClass.name],
                    parameters: [
                        ...this.buildParameters(pathParams, 'path'),
                        ...this.buildParameters(queryParams, 'query'),
                        ...this.buildParameters(headerParams, 'header')
                    ],
                    requestBody: this.buildOpenApiBody(bodyMetadata)
                };
                res[fullPath][route.httpMethod] = operation;
            }
        }

        return res;
    }

    private buildOpenApiBody(metadata: BodyMetadata | undefined): OpenApiRequestBodyObject | undefined {
        if (!metadata) {
            return undefined;
        }
        const propMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(metadata.modelClass);
        const schema: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(propMeta);
        return {
            required: metadata.required,
            description: metadata.description,
            content: { [MimeType.JSON]: { schema } }
        };
    }

    private buildOpenApiSchemaForProperties(propMeta: Record<string, PropertyMetadata>): OpenApiSchemaObject {
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
                case 'string': {
                    properties[key] = { type: meta.type, format: meta.format, description: meta.description };
                    continue;
                }
                case 'object': {
                    const objectPropMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(meta.cls);
                    properties[key] = { ...this.buildOpenApiSchemaForProperties(objectPropMeta), description: meta.description };
                    continue;
                }
                case Relation.ONE_TO_ONE:
                case Relation.MANY_TO_ONE: {
                    const objectPropMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(meta.target());
                    properties[key] = { ...this.buildOpenApiSchemaForProperties(objectPropMeta), description: meta.description };
                    continue;
                }
                case Relation.MANY_TO_MANY: {
                    // TODO: How to handle this?
                    continue;
                }
                case Relation.ONE_TO_MANY: {
                    const items: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties({
                        items: { type: 'object', cls: meta.target(), required: true, description: undefined }
                    });
                    properties[key] = {
                        type: 'array',
                        description: meta.description,
                        items
                    };
                    continue;
                }
                case 'array': {
                    const items: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties({ items: meta.items });
                    properties[key] = {
                        type: 'array',
                        description: meta.description,
                        items
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
                const propMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(meta.cls);
                return {
                    description: meta.description,
                    ...this.buildOpenApiSchemaForProperties(propMeta)
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