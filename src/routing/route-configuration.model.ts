import { NextFunction } from 'express';

import { Route } from './controller-route-configuration.model';
import { HttpRequest, HttpResponse } from '../http';
import { BodyMetadata, BodyMetadataInput, HeaderParamMetadata, HeaderParamMetadataInput, PathParamMetadata, PathParamMetadataInput, QueryParamMetadata, QueryParamMetadataInput } from './decorators';
import { HttpMethod } from '../http/http-method.enum';
import { OpenApiResponse } from '../open-api';
import { Newable, OmitStrict } from '../types';
import { ArrayParamMetadata, ArrayParamMetadataInput, BooleanParamMetadata, BooleanParamMetadataInput, DateParamMetadata, DateParamMetadataInput, NumberParamMetadata, NumberParamMetadataInput, ObjectParamMetadata, ObjectParamMetadataInput, StringParamMetadata, StringParamMetadataInput } from './models';
import { ArrayPropertyItemMetadata, ArrayPropertyItemMetadataInput } from '../entity';

// eslint-disable-next-line jsdoc/require-jsdoc
type PathMetaObjectToParamsObject<PathMetaObject extends Record<string, PathParamMetadata>> = {
    [K in keyof PathMetaObject]: ParamMetadataToType<PathMetaObject[K]>
};

// eslint-disable-next-line jsdoc/require-jsdoc
type QueryMetaObjectToParamsObject<QueryMetaObject extends Record<string, QueryParamMetadata>> = {
    [K in keyof QueryMetaObject]: ParamMetadataToType<QueryMetaObject[K]>
};

// eslint-disable-next-line jsdoc/require-jsdoc
type HeaderMetaObjectToParamsObject<HeaderMetaObject extends Record<string, HeaderParamMetadata>> = {
    [K in keyof HeaderMetaObject]: ParamMetadataToType<HeaderMetaObject[K]>
};

// eslint-disable-next-line jsdoc/require-jsdoc
type BodyMetaInputObjectToMetaObject<BodyMetaInputObject extends BodyMetadataInput & { modelClass: Newable<unknown> }> =
    // eslint-disable-next-line jsdoc/require-jsdoc
    MergeRequired<BodyMetaInputObject, BodyMetadata & { modelClass: BodyMetaInputObject['modelClass'] }>;

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
type HeaderMetaInputObjectToMetaObject<HeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>> = {
    [K in keyof HeaderMetaInputObject]: MergeRequired<
        HeaderMetaInputObject[K],
        ParamMetadataInputToMeta<HeaderMetaInputObject[K]>
    >;
};

// eslint-disable-next-line stylistic/max-len, jsdoc/require-jsdoc
type ParamMetadataInputToMeta<M extends (PathParamMetadataInput | QueryParamMetadataInput | HeaderParamMetadataInput | ArrayPropertyItemMetadataInput)> =
    M extends StringParamMetadataInput
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
                            : never;

// eslint-disable-next-line jsdoc/require-jsdoc
type MergeRequired<I, M> = I extends { required: false } ? M & { required: false } : M & { required: true };

// eslint-disable-next-line jsdoc/require-jsdoc
type RawParamMetadataToType<M extends (
    PathParamMetadata | QueryParamMetadata | HeaderParamMetadata | ArrayPropertyItemMetadata
    | OmitStrict<PathParamMetadata, 'name'> | OmitStrict<QueryParamMetadata, 'name'> | OmitStrict<HeaderParamMetadata, 'name'>
)> =
    M extends StringParamMetadata
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
                            : never;

// eslint-disable-next-line jsdoc/require-jsdoc
type ParamMetadataToType<M extends (
    PathParamMetadata | QueryParamMetadata | HeaderParamMetadata | ArrayPropertyItemMetadata
    | OmitStrict<PathParamMetadata, 'name'> | OmitStrict<QueryParamMetadata, 'name'> | OmitStrict<HeaderParamMetadata, 'name'>
)> =
    // eslint-disable-next-line jsdoc/require-jsdoc
    M extends { required: false }
        ? RawParamMetadataToType<M> | undefined
        : RawParamMetadataToType<M>;

// eslint-disable-next-line jsdoc/require-jsdoc
type InferModel<T> =
    // eslint-disable-next-line jsdoc/require-jsdoc
    T extends { modelClass: Newable<infer U> }
        ? U
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
    openApi: OpenApiRouteConfiguration
};

/**
 * The input to create a new route configuration.
 */
export type RouteConfigurationInput<
    // eslint-disable-next-line jsdoc/require-jsdoc
    BodyMetaInputObject extends BodyMetadataInput & { modelClass: Newable<unknown> },
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
    'bodyMetadata' | 'pathParams' | 'queryParams' | 'headerParams' | 'openApi'
> & {
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
    openApi?: Partial<OpenApiRouteConfiguration> & Pick<OpenApiRouteConfiguration, 'useInOpenApi'>
};