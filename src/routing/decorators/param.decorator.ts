import { Header } from '../../http';
import { MetadataUtilities } from '../../utilities';
import { ArrayParamMetadata, ArrayParamMetadataInput, BooleanParamMetadata, BooleanParamMetadataInput, DateParamMetadata, DateParamMetadataInput, NumberParamMetadata, NumberParamMetadataInput, ObjectParamMetadata, ObjectParamMetadataInput, StringParamMetadata, StringParamMetadataInput } from '../models';

export type PathParamMetadata = StringParamMetadata
    | NumberParamMetadata
    | BooleanParamMetadata
    | DateParamMetadata;

export type PathParamMetadataInput = StringParamMetadataInput
    | NumberParamMetadataInput
    | BooleanParamMetadataInput
    | DateParamMetadataInput;

export type QueryParamMetadata = StringParamMetadata
    | NumberParamMetadata
    | BooleanParamMetadata
    | DateParamMetadata
    | ObjectParamMetadata
    | ArrayParamMetadata;

export type QueryParamMetadataInput = StringParamMetadataInput
    | NumberParamMetadataInput
    | BooleanParamMetadataInput
    | DateParamMetadataInput
    | ObjectParamMetadataInput
    | ArrayParamMetadataInput;

export type HeaderParamMetadata = (
    StringParamMetadata
    | NumberParamMetadata
    | BooleanParamMetadata
    | DateParamMetadata
    | ObjectParamMetadata
    | ArrayParamMetadata
) & {
    name: Header
};

export type HeaderParamMetadataInput = StringParamMetadataInput
    | NumberParamMetadataInput
    | BooleanParamMetadataInput
    | DateParamMetadataInput
    | ObjectParamMetadataInput
    | ArrayParamMetadataInput;

// eslint-disable-next-line typescript/no-namespace
export namespace Param {
    export function path(name: string, options: PathParamMetadataInput = {}): ParameterDecorator {
        const fullMetadata: PathParamMetadata = {
            name: name,
            required: true,
            type: 'string',
            format: undefined,
            unique: false,
            description: undefined,
            ...options
        };
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

    export function query(name: string, options: QueryParamMetadataInput = {}): ParameterDecorator {
        const fullMetadata: QueryParamMetadata = {
            name: name,
            required: true,
            type: 'string',
            format: undefined,
            unique: false,
            description: undefined,
            ...options
        };
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

    export function header(
        name: Header,
        options: HeaderParamMetadataInput = {}
    ): ParameterDecorator {
        const fullMetadata: HeaderParamMetadata = {
            name: name,
            required: true,
            type: 'string',
            format: undefined,
            unique: false,
            description: undefined,
            ...options
        };
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