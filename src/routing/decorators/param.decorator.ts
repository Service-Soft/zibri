import { fillArrayItemPropertyMetadata } from '../../entity';
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
    export function path(name: string, options: PathParamMetadataInput = { type: 'string' }): ParameterDecorator {
        const fullMetadata: PathParamMetadata = resolvePathParamMetadata(name, options);
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

    export function query(name: string, options: QueryParamMetadataInput = { type: 'string' }): ParameterDecorator {
        const fullMetadata: QueryParamMetadata = resolveQueryParamMetadata(name, options);
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

    export function header(name: Header, options: HeaderParamMetadataInput = { type: 'string' }): ParameterDecorator {
        const fullMetadata: HeaderParamMetadata = resolveHeaderParamMetadata(name, options);
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

function resolvePathParamMetadata(name: string, data: PathParamMetadataInput): PathParamMetadata {
    switch (data.type) {
        case 'string': {
            return {
                name,
                required: true,
                unique: false,
                format: undefined,
                description: undefined,
                maxLength: undefined,
                minLength: undefined,
                regex: undefined,
                enum: undefined,
                ...data
            };
        }
        case 'number': {
            return {
                name,
                required: true,
                unique: false,
                description: undefined,
                min: undefined,
                max: undefined,
                ...data
            };
        }
        case 'boolean': {
            return {
                name,
                required: true,
                description: undefined,
                ...data
            };
        }
        case 'date': {
            return {
                name,
                required: true,
                description: undefined,
                after: undefined,
                before: undefined,
                ...data
            };
        }
    }
}

function resolveQueryParamMetadata(name: string, data: QueryParamMetadataInput): QueryParamMetadata {
    switch (data.type) {
        case 'string': {
            return {
                name,
                required: true,
                unique: false,
                format: undefined,
                description: undefined,
                maxLength: undefined,
                minLength: undefined,
                regex: undefined,
                enum: undefined,
                ...data
            };
        }
        case 'number': {
            return {
                name,
                required: true,
                unique: false,
                description: undefined,
                min: undefined,
                max: undefined,
                ...data
            };
        }
        case 'date': {
            return {
                name,
                required: true,
                description: undefined,
                after: undefined,
                before: undefined,
                ...data
            };
        }
        case 'boolean':
        case 'object': {
            return {
                name,
                required: true,
                description: undefined,
                ...data
            };
        }
        case 'array': {
            return {
                name,
                required: true,
                description: undefined,
                ...data,
                items: fillArrayItemPropertyMetadata(data.items, name)
            };
        }
    }
}

function resolveHeaderParamMetadata(name: string, data: HeaderParamMetadataInput): HeaderParamMetadata {
    return resolveQueryParamMetadata(name, data);
}