import { Header } from '../../http/header.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ArrayParamMetadata, ArrayParamMetadataInput } from '../models/array-param-metadata.model';
import { BooleanParamMetadata, BooleanParamMetadataInput } from '../models/boolean-param-metadata.model';
import { DateParamMetadata, DateParamMetadataInput } from '../models/date-param-metadata.model';
import { NumberParamMetadata, NumberParamMetadataInput } from '../models/number-param-metadata.model';
import { ObjectParamMetadata, ObjectParamMetadataInput } from '../models/object-param-metadata.model';
import { OneOfParamMetadata, OneOfPathParamMetadataInput, OneOfQueryParamMetadataInput } from '../models/one-of-param-metadata.model';
import { StringParamMetadata, StringParamMetadataInput } from '../models/string-param-metadata.model';
import { createHeaderParamMetadata, createPathParamMetadata, createQueryParamMetadata } from '../param-metdata.helpers';

/**
 * Metadata of path parameters.
 */
export type PathParamMetadata = StringParamMetadata
    | NumberParamMetadata
    | BooleanParamMetadata
    | DateParamMetadata
    | OneOfParamMetadata;

/**
 * Metadata Input of path parameters.
 */
export type PathParamMetadataInput = StringParamMetadataInput
    | NumberParamMetadataInput
    | BooleanParamMetadataInput
    | DateParamMetadataInput
    | OneOfPathParamMetadataInput;

/**
 * Metadata of query parameters.
 */
export type QueryParamMetadata = StringParamMetadata
    | NumberParamMetadata
    | BooleanParamMetadata
    | DateParamMetadata
    | ObjectParamMetadata
    | ArrayParamMetadata
    | OneOfParamMetadata;

/**
 * Metadata Input of query parameters.
 */
export type QueryParamMetadataInput = StringParamMetadataInput
    | NumberParamMetadataInput
    | BooleanParamMetadataInput
    | DateParamMetadataInput
    | ObjectParamMetadataInput
    | ArrayParamMetadataInput
    | OneOfQueryParamMetadataInput;

/**
 * Metadata of header parameters.
 */
export type HeaderParamMetadata = (
    StringParamMetadata
    | NumberParamMetadata
    | BooleanParamMetadata
    | DateParamMetadata
    | ObjectParamMetadata
    | ArrayParamMetadata
    | OneOfParamMetadata
) & {
    /**
     * The name of the header.
     */
    name: Header
};

/**
 * Metadata Input of path parameters.
 */
export type HeaderParamMetadataInput = StringParamMetadataInput
    | NumberParamMetadataInput
    | BooleanParamMetadataInput
    | DateParamMetadataInput
    | ObjectParamMetadataInput
    | ArrayParamMetadataInput
    | OneOfQueryParamMetadataInput;

/**
 * Bundles decorators for injecting path, query and header parameters.
 */
// eslint-disable-next-line typescript/no-namespace
export namespace Param {

    /**
     * Marks a path parameter.
     * @param name - The name of the path parameter.
     * @param options - Additional options like the type of the parameter etc.
     */
    export function path(name: string, options: PathParamMetadataInput = { type: 'string' }): ParameterDecorator {
        const fullMetadata: PathParamMetadata = createPathParamMetadata(name, options);
        return (target, propertyKey, parameterIndex) => {
            const ctor: Function = target.constructor;
            MetadataUtilities.setFilePath(ctor);
            const key: string = propertyKey?.toString() ?? '';
            const pathParams: Record<number, PathParamMetadata> = MetadataUtilities.getRoutePathParams(ctor, key);
            pathParams[parameterIndex] = fullMetadata;
            MetadataUtilities.setRoutePathParams(ctor, pathParams, key);
        };
    }

    /**
     * Marks a query parameter.
     * @param name - The name of the query parameter.
     * @param options - Additional options, like the type etc.
     */
    export function query(name: string, options: QueryParamMetadataInput = { type: 'string' }): ParameterDecorator {
        const fullMetadata: QueryParamMetadata = createQueryParamMetadata(name, options);
        return (target, propertyKey, parameterIndex) => {
            const ctor: Function = target.constructor;
            MetadataUtilities.setFilePath(ctor);
            const key: string = propertyKey?.toString() ?? '';
            const queryParams: Record<number, QueryParamMetadata> = MetadataUtilities.getRouteQueryParams(ctor, key);
            queryParams[parameterIndex] = fullMetadata;
            MetadataUtilities.setRouteQueryParams(ctor, queryParams, key);
        };
    }

    /**
     * Marks a header parameter.
     * @param name - The name of the header parameter.
     * @param options - Additional options, like the type etc.
     */
    export function header(name: Header, options: HeaderParamMetadataInput = { type: 'string' }): ParameterDecorator {
        const fullMetadata: HeaderParamMetadata = createHeaderParamMetadata(name, options);
        return (target, propertyKey, parameterIndex) => {
            const ctor: Function = target.constructor;
            MetadataUtilities.setFilePath(ctor);
            const key: string = propertyKey?.toString() ?? '';
            const headerParams: Record<number, HeaderParamMetadata> = MetadataUtilities.getRouteHeaderParams(ctor, key);
            headerParams[parameterIndex] = fullMetadata;
            MetadataUtilities.setRouteHeaderParams(ctor, headerParams, key);
        };
    }
}