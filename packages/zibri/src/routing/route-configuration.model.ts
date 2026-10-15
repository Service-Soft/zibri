import { Readable } from 'node:stream';

import { NextFunction } from 'express';

import { Route } from './controller-route-configuration.model';
import { RouteAuthConfiguration } from '../auth/models/route-auth-configuration.model';
import { ArrayPropertyItemMetadataInput, ArrayPropertyItemMetadata } from '../entity/models/array-property-metadata.model';
import { DeclaredBodyShape, DeclaredShape, ShapeType } from '../entity/models/shape-type.model';
import { HandlerTimeout } from '../http/handler-timeout.type';
import { HttpMethod } from '../http/http-method.enum';
import { HttpRequest } from '../http/http-request.model';
import { HttpResponse } from '../http/http-response.model';
import { OpenApiResponse } from '../open-api/open-api.model';
import { OmitStrict } from '../types/omit-strict.type';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata, PathParamMetadataInput, QueryParamMetadataInput, HeaderParamMetadataInput } from './decorators/param.decorator';
import { ArrayParamMetadataInput, ArrayParamMetadata } from './models/array-param-metadata.model';
import { BooleanParamMetadataInput, BooleanParamMetadata } from './models/boolean-param-metadata.model';
import { DateParamMetadataInput, DateParamMetadata } from './models/date-param-metadata.model';
import { NumberParamMetadataInput, NumberParamMetadata } from './models/number-param-metadata.model';
import { ObjectParamMetadataInput, ObjectParamMetadata } from './models/object-param-metadata.model';
import { OneOfParamMetadata } from './models/one-of-param-metadata.model';
import { StringParamMetadataInput, StringParamMetadata } from './models/string-param-metadata.model';
import { SupportedVersionsOptions } from '../versioning/supported-versions-options.model';
import { BodyMetadata, DeclaredBodyInput } from './decorators/body-metadata.model';
import { MimeType } from '../http/mime-type.enum';

// eslint-disable-next-line jsdoc/require-jsdoc
type PathMetaObjectToParamsObject<PathMetaObject extends Record<string, PathParamMetadata>> = {
    [K in keyof PathMetaObject]: ParamMetadataToType<PathMetaObject[K]>
};

// eslint-disable-next-line jsdoc/require-jsdoc
type QueryMetaObjectToParamsObject<QueryMetaObject extends Record<string, QueryParamMetadata>> = {
    [K in keyof QueryMetaObject]: ParamMetadataToType<QueryMetaObject[K]>
};

// eslint-disable-next-line jsdoc/require-jsdoc
export type HeaderMetaObjectToParamsObject<HeaderMetaObject extends Record<string, HeaderParamMetadata>> = {
    [K in keyof HeaderMetaObject]: ParamMetadataToType<HeaderMetaObject[K]>
};

// eslint-disable-next-line jsdoc/require-jsdoc
type BodyMetaInputObjectToMetaObject<I extends DeclaredBodyInput> = I extends { type: MimeType.OCTET_STREAM }
    ? MergeRequired<I, BodyMetadata>
    // eslint-disable-next-line jsdoc/require-jsdoc
    : MergeRequired<I, BodyMetadata & { shape: DeclaredBodyShape<I> }>;

// eslint-disable-next-line jsdoc/require-jsdoc
type PathMetaInputObjectToMetaObject<PathMetaInputObject extends Record<string, PathParamMetadataInput>> = {
    [K in keyof PathMetaInputObject]: MergeRequired<
        PathMetaInputObject[K],
        ParamMetadataInputToMeta<PathMetaInputObject[K]>
    >;
};

// eslint-disable-next-line jsdoc/require-jsdoc
type QueryMetaInputObjectToMetaObject<QueryMetaInputObject extends Record<string, QueryParamMetadataInput>> = {
    [K in keyof QueryMetaInputObject]: MergeRequired<
        QueryMetaInputObject[K],
        ParamMetadataInputToMeta<QueryMetaInputObject[K]>
    >;
};

// eslint-disable-next-line jsdoc/require-jsdoc
export type HeaderMetaInputObjectToMetaObject<HeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>> = {
    [K in keyof HeaderMetaInputObject]: MergeRequired<
        HeaderMetaInputObject[K],
        ParamMetadataInputToMeta<HeaderMetaInputObject[K]>
    >;
};

// eslint-disable-next-line stylistic/max-len, jsdoc/require-jsdoc
type ParamMetadataInputToMeta<M extends (PathParamMetadataInput | QueryParamMetadataInput | HeaderParamMetadataInput | ArrayPropertyItemMetadataInput)>
    = M extends StringParamMetadataInput
        ? StringParamMetadata
        : M extends NumberParamMetadataInput
            ? NumberParamMetadata
            : M extends BooleanParamMetadataInput
                ? BooleanParamMetadata
                : M extends DateParamMetadataInput
                    ? DateParamMetadata
                    : M extends ObjectParamMetadataInput
                        ? ObjectParamMetadata
                        : M extends ArrayParamMetadataInput
                            ? ArrayParamMetadata
                            // eslint-disable-next-line jsdoc/require-jsdoc
                            : M extends { type: 'oneOf', shapes: (infer S)[] }
                                // eslint-disable-next-line jsdoc/require-jsdoc
                                ? OneOfParamMetadata & { shapes: DeclaredShape<S>[] }
                                : never;

// eslint-disable-next-line jsdoc/require-jsdoc
type MergeRequired<I, M> = I extends { required: false } ? M & { required: false } : M & { required: true };

// eslint-disable-next-line jsdoc/require-jsdoc
type RawParamMetadataToType<M extends (
    PathParamMetadata | QueryParamMetadata | HeaderParamMetadata | ArrayPropertyItemMetadata
    | OmitStrict<PathParamMetadata, 'name'> | OmitStrict<QueryParamMetadata, 'name'> | OmitStrict<HeaderParamMetadata, 'name'>
)>
    = M extends StringParamMetadata
        ? string
        : M extends NumberParamMetadata
            ? number
            : M extends BooleanParamMetadata
                ? boolean
                : M extends DateParamMetadata
                    ? Date
                    : M extends ObjectParamMetadata
                        ? InstanceType<ReturnType<M['cls']>>
                        : M extends ArrayParamMetadata
                            ? ParamMetadataToType<M['items']>[]
                            // eslint-disable-next-line jsdoc/require-jsdoc
                            : M extends OneOfParamMetadata & { shapes: (infer S)[] }
                                ? ShapeType<S>
                                : never;

// eslint-disable-next-line jsdoc/require-jsdoc
type ParamMetadataToType<M extends (
    PathParamMetadata | QueryParamMetadata | HeaderParamMetadata | ArrayPropertyItemMetadata
    | OmitStrict<PathParamMetadata, 'name'> | OmitStrict<QueryParamMetadata, 'name'> | OmitStrict<HeaderParamMetadata, 'name'>
)>
    // eslint-disable-next-line jsdoc/require-jsdoc
    = M extends { required: false }
        ? RawParamMetadataToType<M> | undefined
        : RawParamMetadataToType<M>;

// eslint-disable-next-line jsdoc/require-jsdoc
type InferModel<T extends BodyMetadata> = T extends { shape: infer S }
    ? ShapeType<S>
    // eslint-disable-next-line jsdoc/require-jsdoc
    : T extends { type: MimeType.OCTET_STREAM }
        ? Readable
        : never;

/**
 * Configuration on how to handle open api for the route.
 */
export type OpenApiRouteConfiguration = {
    /**
     * Whether or not the route should be displayed in the open api explorer.
     */
    useInOpenApi: false
} | {
    /**
     * Whether or not the route should be displayed in the open api explorer.
     */
    useInOpenApi: true,
    /**
     * The possible responses in the open api format for the route.
     */
    responses: OpenApiResponse[],
    /**
     * Tags to be used by open api.
     */
    tags: string[]
};

/**
 * The handler used when manually registering a route.
 */
export type RouteHandler<
    BodyMetaObject extends BodyMetadata,
    PathParamsObject extends Record<string, unknown>,
    QueryParamsObject extends Record<string, unknown>,
    HeaderParamsObject extends Record<string, unknown>
> = (
    req: HttpRequest<
        // eslint-disable-next-line jsdoc/require-jsdoc
        BodyMetaObject extends { required: false } ? InferModel<BodyMetaObject> | undefined : InferModel<BodyMetaObject>,
        PathParamsObject,
        QueryParamsObject,
        HeaderParamsObject
    >,
    res: HttpResponse,
    next: NextFunction
) => unknown | Promise<unknown>;

/**
 * Configuration for a single endpoint route.
 */
export type RouteConfiguration<
    BodyMetaObject extends BodyMetadata,
    PathMetaObject extends Record<string, PathParamMetadata>,
    QueryMetaObject extends Record<string, QueryParamMetadata>,
    HeaderMetaObject extends Record<string, HeaderParamMetadata>
> = {
    /**
     * The http method used by the endpoint.
     */
    httpMethod: HttpMethod,
    /**
     * The actual route under which the endpoint can be reached.
     */
    route: Route,
    /**
     * The handler that is responsible for handling requests on the route.
     */
    handler: RouteHandler<
        MergeRequired<BodyMetaObject, BodyMetaObject>,
        PathMetaObjectToParamsObject<PathMetaObject>,
        QueryMetaObjectToParamsObject<QueryMetaObject>,
        HeaderMetaObjectToParamsObject<HeaderMetaObject>
    >,
    /**
     * The metadata for the request body.
     */
    bodyMetadata: BodyMetadata | undefined,
    /**
     * An object of metadata for the path parameters.
     */
    pathParams: PathMetaObject,
    /**
     * An object of metadata for the query parameters.
     */
    queryParams: QueryMetaObject,
    /**
     * An object of metadata for the header parameters.
     */
    headerParams: HeaderMetaObject,
    /**
     * Configuration on how to handle open api.
     */
    openApi: OpenApiRouteConfiguration,
    /**
     * Configuration on what versions are supported.
     */
    versions: SupportedVersionsOptions,
    /**
     * What this route says about who may reach it.
     *
     * Undefined is a statement too: it is the same thing a controller route carrying no \@Auth
     * decorator says, so the application's `defaultAuth` decides.
     */
    auth: RouteAuthConfiguration | undefined,
    /**
     * How long the handler has to produce a result.
     *
     * Undefined leaves it to the application's `handlerInMs`, which is what a controller route
     * declaring nothing does.
     */
    timeoutInMs: HandlerTimeout | undefined
};

/**
 * The input to create a new route configuration.
 */
export type RouteConfigurationInput<
    BodyMetaInputObject extends DeclaredBodyInput,
    PathMetaInputObject extends Record<string, PathParamMetadataInput>,
    QueryMetaInputObject extends Record<string, QueryParamMetadataInput>,
    HeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>
> = OmitStrict<
    RouteConfiguration<
        BodyMetaInputObjectToMetaObject<BodyMetaInputObject>,
        PathMetaInputObjectToMetaObject<PathMetaInputObject>,
        QueryMetaInputObjectToMetaObject<QueryMetaInputObject>,
        HeaderMetaInputObjectToMetaObject<HeaderMetaInputObject>
    >,
    'bodyMetadata' | 'pathParams' | 'queryParams' | 'headerParams' | 'openApi' | 'versions' | 'auth' | 'timeoutInMs'
> & {
    /**
     * What this route says about who may reach it.
     *
     * Leave it out to let the application's `defaultAuth` decide, which is what a controller route
     * carrying no \@Auth decorator does.
     */
    auth?: RouteAuthConfiguration,
    /**
     * How long the handler has to produce a result.
     *
     * Leave it out to let the application's `handlerInMs` decide. Use `'none'` for a route that
     * legitimately runs for as long as it takes.
     */
    timeoutInMs?: HandlerTimeout,
    /**
     * The input metadata for the request body.
     */
    bodyMetadata?: BodyMetaInputObject,
    /**
     * An object of metadata input for the path parameters.
     */
    pathParams?: PathMetaInputObject,
    /**
     * An object of metadata input for the query parameters.
     */
    queryParams?: QueryMetaInputObject,
    /**
     * An object of metadata input for the header parameters.
     */
    headerParams?: HeaderMetaInputObject,
    /**
     * Configuration on how to handle open api.
     */
    openApi?: Partial<OpenApiRouteConfiguration> & Pick<OpenApiRouteConfiguration, 'useInOpenApi'>,
    /**
     * Configuration on what versions are supported.
     * Defaults to '^latest'.
     */
    versions?: SupportedVersionsOptions
};