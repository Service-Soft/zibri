import { createArrayItemPropertyMetadata } from '../entity';
import { PathParamMetadataInput, PathParamMetadata, QueryParamMetadataInput, QueryParamMetadata, HeaderParamMetadataInput, HeaderParamMetadata } from './decorators';

/**
 * Creates path parameter metadata for the parameter with the given name and input.
 * @param name - The name of the path parameter to create the metadata for.
 * @param data - The input data for resolving the metadata.
 * @returns The created metadata.
 */
export function createPathParamMetadata(name: string, data: PathParamMetadataInput): PathParamMetadata {
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

/**
 * Creates query parameter metadata for the parameter with the given name and input.
 * @param name - The name of the query parameter to create the metadata for.
 * @param data - The input data for resolving the metadata.
 * @returns The created metadata.
 */
export function createQueryParamMetadata(name: string, data: QueryParamMetadataInput): QueryParamMetadata {
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
                items: createArrayItemPropertyMetadata(data.items, name)
            };
        }
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
export function createHeaderParamMetadata(name: string, data: HeaderParamMetadataInput): HeaderParamMetadata {
    return createQueryParamMetadata(name, data);
}