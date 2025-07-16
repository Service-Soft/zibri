import { Header } from '../../http';
import { MetadataUtilities } from '../../utilities';
import { ArrayParamMetadata, ArrayParamMetadataInput, BooleanParamMetadata, BooleanParamMetadataInput, DateParamMetadata, DateParamMetadataInput, NumberParamMetadata, NumberParamMetadataInput, ObjectParamMetadata, ObjectParamMetadataInput, StringParamMetadata, StringParamMetadataInput } from '../models';
import { createHeaderParamMetadata, createPathParamMetadata, createQueryParamMetadata } from '../param-metdata.helpers';

/**
 * Metadata of path parameters.
 */
export type PathParamMetadata = StringParamMetadata
    | NumberParamMetadata
    | BooleanParamMetadata
    | DateParamMetadata;

/**
 * Metadata Input of path parameters.
 */
export type PathParamMetadataInput = StringParamMetadataInput
    | NumberParamMetadataInput
    | BooleanParamMetadataInput
    | DateParamMetadataInput;

/**
 * Metadata of query parameters.
 */
export type QueryParamMetadata = StringParamMetadata
    | NumberParamMetadata
    | BooleanParamMetadata
    | DateParamMetadata
    | ObjectParamMetadata
    | ArrayParamMetadata;

/**
 * Metadata Input of query parameters.
 */
export type QueryParamMetadataInput = StringParamMetadataInput
    | NumberParamMetadataInput
    | BooleanParamMetadataInput
    | DateParamMetadataInput
    | ObjectParamMetadataInput
    | ArrayParamMetadataInput;

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
    | ArrayParamMetadataInput;

/**
 * Bundles decorators for injecting path, query and header parameters.
 */
// eslint-disable-next-line typescript/no-namespace
export namespace Param {
    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Marks a path parameter.
     * @param name - The name of the path parameter.
     * @param options - Additional options like the type of the parameter etc.
     */
    export function path(name: string, options: PathParamMetadataInput = { type: 'string' }): ParameterDecorator {
        const fullMetadata: PathParamMetadata = createPathParamMetadata(name, options);
        return (target, propertyKey, parameterIndex) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);
            const key: string = propertyKey?.toString() ?? '';
            const pathParams: Record<number, PathParamMetadata> = MetadataUtilities.getRoutePathParams(ctor, key);
            pathParams[parameterIndex] = fullMetadata;
            MetadataUtilities.setRoutePathParams(ctor, pathParams, key);
        };
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Marks a query parameter.
     * @param name - The name of the query parameter.
     * @param options - Additional options, like the type etc.
     */
    export function query(name: string, options: QueryParamMetadataInput = { type: 'string' }): ParameterDecorator {
        const fullMetadata: QueryParamMetadata = createQueryParamMetadata(name, options);
        return (target, propertyKey, parameterIndex) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);
            const key: string = propertyKey?.toString() ?? '';
            const queryParams: Record<number, QueryParamMetadata> = MetadataUtilities.getRouteQueryParams(ctor, key);
            queryParams[parameterIndex] = fullMetadata;
            MetadataUtilities.setRouteQueryParams(ctor, queryParams, key);
        };
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Marks a header parameter.
     * @param name - The name of the header parameter.
     * @param options - Additional options, like the type etc.
     */
    export function header(name: Header, options: HeaderParamMetadataInput = { type: 'string' }): ParameterDecorator {
        const fullMetadata: HeaderParamMetadata = createHeaderParamMetadata(name, options);
        return (target, propertyKey, parameterIndex) => {
            const ctor: Function = target.constructor;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);
            const key: string = propertyKey?.toString() ?? '';
            const headerParams: Record<number, HeaderParamMetadata> = MetadataUtilities.getRouteHeaderParams(ctor, key);
            headerParams[parameterIndex] = fullMetadata;
            MetadataUtilities.setRouteHeaderParams(ctor, headerParams, key);
        };
    }
}