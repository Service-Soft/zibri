import path from 'path';

import { Request, Response } from 'express';
import { TagObject } from 'openapi3-ts/dist/oas31';
import swaggerUi from 'swagger-ui-express';

import { ZibriApplication } from '../application';
import { AssetServiceInterface } from '../assets';
import { inject, ZIBRI_DI_TOKENS } from '../di';
import { PropertyMetadata } from '../entity';
import { ArrayPropertyMetadata, ObjectPropertyMetadata } from '../entity/models';
import { GlobalRegistry } from '../global';
import { MimeType } from '../http';
import { LoggerInterface } from '../logging';
import { ArrayQueryParamMetadata, BodyMetadata, ControllerRouteConfiguration, HeaderParamMetadata, PathParamMetadata, QueryParamMetadata, Route } from '../routing';
import { OpenApiServiceInterface } from './open-api-service.interface';
import { OpenApiDefinition, OpenApiOperation, OpenApiParameter, OpenApiPaths, OpenApiRequestBodyObject, OpenApiSchemaObject } from './open-api.model';
import { MissingBaseRouteError } from '../routing/missing-base-route.error';
import { Newable } from '../types';
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
                // Build OpenAPI–style path (convert :id → {id})
                const fullPath: string = `${baseRoute}${route.route}`.replaceAll(/:([^/]+)/g, '{$1}');

                const pathParamNames: string[] = this.extractPathParamNames(fullPath);
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
                res[fullPath] ??= {};
                const operation: OpenApiOperation = {
                    responses: {},
                    tags: [controllerClass.name],
                    parameters: [
                        ...this.buildPathParameters(pathParamNames, pathParams),
                        ...this.buildQueryParameters(queryParams),
                        ...this.buildHeaderParameters(headerParams)
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
        const schema: OpenApiSchemaObject = this.buildOpenApiSchemaForModel(metadata.modelClass);
        return {
            required: metadata.required,
            description: metadata.description,
            content: { [MimeType.JSON]: { schema } }
        };
    }

    private buildOpenApiSchemaForModel(cls: Newable<unknown>): OpenApiSchemaObject {
        // 1) Grab all the per‐property metadata for this class
        const propMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        // 2) Build `properties` and `required` arrays
        const properties: Record<string, OpenApiSchemaObject> = {};
        const required: string[] = [];

        for (const [key, meta] of Object.entries(propMeta)) {
            // mark required
            if (meta.required) {
                required.push(key);
            }
            switch (meta.type) {
                case 'date': {
                    properties[key] = { type: 'string', format: 'date-time' };
                    continue;
                }
                case 'string':
                case 'number': {
                    properties[key] = { type: meta.type };
                    continue;
                }
                case 'object': {
                    const m: ObjectPropertyMetadata = meta;
                    properties[key] = this.buildOpenApiSchemaForModel(m.cls);
                    continue;
                }
                case 'array': {
                    const m: ArrayPropertyMetadata = meta;
                    let items: OpenApiSchemaObject;
                    if (typeof m.itemType === 'function') {
                        items = this.buildOpenApiSchemaForModel(m.itemType);
                    }
                    else if (m.itemType === 'date') {
                        items = { type: 'string', format: 'date-time' };
                    }
                    else {
                        items = { type: m.itemType };
                    }
                    properties[key] = {
                        type: 'array',
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
            ...required.length > 0 ? { required } : {}
        };
    }

    private extractPathParamNames(path: string): string[] {
        return [...path.matchAll(/{([^}]+)}/g)].map(match => match[1]);
    }

    private buildPathParameters(
        pathParamNames: string[],
        pathParams: Record<number, PathParamMetadata>
    ): OpenApiParameter[] {
        return pathParamNames.map(paramName => {
            // Find if parameter has decorator metadata
            const metadata: PathParamMetadata | undefined = Object.entries(pathParams)
                .find(([, metadata]) => metadata.name === paramName)?.[1];

            if (!metadata) {
                throw new Error(`Error when resolving path parameter "${paramName}": Did you forget to decorate one of the parameters?`);
            }

            return {
                name: metadata.name,
                in: 'path',
                required: metadata.required,
                schema: {
                    type: metadata.type
                },
                description: metadata.description
            };
        });
    }

    private buildQueryParameters(queryParams: Record<number, QueryParamMetadata>): OpenApiParameter[] {
        return Object.values(queryParams).map(meta => ({
            name: meta.name,
            in: 'query',
            required: meta.required,
            content: meta.type === 'object'
                ? {
                    [MimeType.JSON]: {
                        schema: this.queryParamToSchema(meta)
                    }
                }
                : undefined,
            schema: meta.type === 'object' ? undefined : this.queryParamToSchema(meta),
            description: meta.description
        }));
    }

    private queryParamToSchema(meta: QueryParamMetadata): OpenApiSchemaObject {
        switch (meta.type) {
            case 'boolean':
            case 'number':
            case 'string': {
                return {
                    type: meta.type
                };
            }
            case 'date': {
                return {
                    type: 'string',
                    format: 'date-time'
                };
            }
            case 'object': {
                return this.buildOpenApiSchemaForModel(meta.cls);
            }
            case 'array': {
                const m: QueryParamMetadata = this.getQueryArrayItemMetadata(meta);
                return {
                    type: 'array',
                    items: this.queryParamToSchema(m)
                };
            }
        }
    }

    private getQueryArrayItemMetadata(metadata: ArrayQueryParamMetadata): QueryParamMetadata {
        switch (metadata.itemType) {
            case 'date':
            case 'string':
            case 'boolean':
            case 'number': {
                return {
                    name: `${metadata.name}.item`,
                    type: metadata.itemType,
                    required: true
                };
            }
            default: {
                return {
                    name: `${metadata.name}.item`,
                    type: 'object',
                    cls: metadata.itemType,
                    required: true
                };
            }
        }
    }

    private buildHeaderParameters(headerParams: Record<number, HeaderParamMetadata>): OpenApiParameter[] {
        return Object.values(headerParams).map(meta => ({
            name: meta.name as string,
            in: 'header',
            required: meta.required,
            schema: this.headerParamToSchema(meta),
            description: meta.description
        }));
    }

    private headerParamToSchema(meta: HeaderParamMetadata): OpenApiSchemaObject {
        switch (meta.type) {
            case 'string':
            case 'number':
            case 'boolean': {
                return {
                    type: meta.type
                };
            }
            case 'date': {
                return {
                    type: 'string',
                    format: 'date-time'
                };
            }
        }
    }
}