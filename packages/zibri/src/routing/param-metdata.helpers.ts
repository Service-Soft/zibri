import { PathParamMetadataInput, PathParamMetadata, QueryParamMetadataInput, QueryParamMetadata, HeaderParamMetadataInput, HeaderParamMetadata } from './decorators/param.decorator';
import { ArrayParamItemMetadataInput, ArrayParamItemMetadata } from './models/array-param-metadata.model';
import { OneOfParamMetadata, OneOfQueryParamMetadataInput, PathParamShapeMetadataInput } from './models/one-of-param-metadata.model';
import { createAnyOfShapesMetadata } from '../entity/decorators/property.decorator';
import { InternalError } from '../error-handling/internal-error.model';
import { RegexUtilities } from '../utilities/regex.utilities';

const pathParamShapeTypes: PathParamShapeMetadataInput['type'][] = ['string', 'number', 'boolean', 'date'];

/**
 * Creates path parameter metadata for the parameter with the given name and input.
 * @param name - The name of the path parameter to create the metadata for.
 * @param data - The input data for resolving the metadata.
 * @returns The created metadata.
 * @throws When a shape of a path parameter that is one of several shapes is not something a path segment is read as.
 */
export function createPathParamMetadata(name: string, data: PathParamMetadataInput): PathParamMetadata {
    switch (data.type) {
        case 'string': {
            RegexUtilities.validateLinear(name, data.regex);
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
                enum: undefined,
                format: 'number',
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
        case 'oneOf': {
            if (data.shapes.some(shape => !pathParamShapeTypes.includes(shape.type))) {
                throw new InternalError([
                    `${name}: Each shape of a path parameter has to be text, a number, a boolean or a date.`,
                    'A path segment is one piece of text, which is what these are read from.'
                ]);
            }
            return createOneOfParamMetadata(name, data);
        }
    }
}

/**
 * Creates the metadata of a parameter that is one of several shapes.
 * @param name - The name of the parameter.
 * @param data - The input data for resolving the metadata.
 * @returns The created metadata.
 */
function createOneOfParamMetadata(name: string, data: OneOfQueryParamMetadataInput): OneOfParamMetadata {
    return {
        name,
        type: 'oneOf',
        required: data.required ?? true,
        description: data.description,
        shapes: createAnyOfShapesMetadata(data.shapes, name).shapes
    };
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
            RegexUtilities.validateLinear(name, data.regex);
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
                enum: undefined,
                format: 'number',
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
        case 'object': {
            return {
                name,
                required: true,
                description: undefined,
                allowAdditionalProperties: false,
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
        case 'array': {
            return {
                name,
                required: true,
                description: undefined,
                totalMaxSize: '100kb',
                ...data,
                items: createArrayParamItemMetadata(data.items, name)
            };
        }
        case 'oneOf': {
            return createOneOfParamMetadata(name, data);
        }
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
export function createHeaderParamMetadata(name: string, data: HeaderParamMetadataInput): HeaderParamMetadata {
    return createQueryParamMetadata(name, data);
}

/**
 * Creates full metadata for an array property item.
 * @param data - The array item input data.
 * @param fullPropertyKey - The full key of the property.
 * @returns The full metadata.
 */
export function createArrayParamItemMetadata(
    data: ArrayParamItemMetadataInput,
    fullPropertyKey: string
): ArrayParamItemMetadata {
    switch (data.type) {
        case 'number': {
            return {
                required: true,
                unique: false,
                description: undefined,
                min: undefined,
                max: undefined,
                enum: undefined,
                format: 'number',
                ...data
            };
        }
        case 'string': {
            RegexUtilities.validateLinear(fullPropertyKey, data.regex);
            return {
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
        case 'object': {
            return {
                required: true,
                description: undefined,
                allowAdditionalProperties: false,
                ...data
            };
        }
        case 'boolean': {
            return {
                required: true,
                description: undefined,
                ...data
            };
        }
        case 'date': {
            return {
                required: true,
                description: undefined,
                after: undefined,
                before: undefined,
                ...data
            };
        }
        case 'array': {
            return {
                required: true,
                description: undefined,
                totalMaxSize: '100kb',
                ...data,
                items: createArrayParamItemMetadata(data.items, fullPropertyKey)
            };
        }
    }
}