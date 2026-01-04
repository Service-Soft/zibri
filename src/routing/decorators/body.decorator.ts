import { PropertyMetadata, Relation } from '../../entity';
import { BasePropertyMetadata } from '../../entity/models/base-property-metadata.model';
import { FileSize, fileSizeToBytes } from '../../entity/models/file-property-metadata.model';
import { MimeType } from '../../http';
import { Newable, OmitStrict } from '../../types';
import { BigNumber, MetadataUtilities, Ms } from '../../utilities';

/**
 * Base metadata shared by all possible http request body properties.
 */
type BaseBodyMetadata = OmitStrict<BasePropertyMetadata, 'excludeFromChangeSets'> & {
    /**
     * The class that defines the structure of the body.
     */
    modelClass: Newable<unknown>,
    /**
     * Whether or not the body is a single modelClass or an array of them.
     */
    isArray: boolean,
    /**
     * Whether or not additional properties are allowed on the body.
     */
    allowAdditionalProperties: boolean,
    /**
     * The index at which the body parameter is provided in the controller method.
     */
    index: number,
    /**
     * The maximum size of the body.
     * Is calculated by adding the base max size and any sizes of file or file array properties on the body model.
     */
    maxSize: BigNumber
};

/**
 * Metadata of json http request body properties.
 */
export type JsonBodyMetadata = BaseBodyMetadata & {
    /**
     * The type of the request body (json).
     */
    type: MimeType.JSON
};

/**
 * Metadata of form data http request body properties.
 */
export type FormDataBodyMetadata = BaseBodyMetadata & {
    /**
     * The type of the request body (form data).
     */
    type: MimeType.FORM_DATA,
    /**
     * The amount of ms after which the temporary file should be deleted from the file system.
     */
    cleanupAfterMs: number
};

/**
 * Metadata for http request body properties.
 */
export type BodyMetadata = JsonBodyMetadata | FormDataBodyMetadata;

/**
 * Metadata Input for http request body properties.
 */
export type BodyMetadataInput = Partial<OmitStrict<BodyMetadata, 'modelClass' | 'index' | 'maxSize'>> & {
    /**
     * The base maximum size of the body.
     *
     * This is IN ADDITION to any file properties on the request body.
     */
    baseMaxSize?: FileSize
};

// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines a http request body property with the given data.
 * @param modelClass - The model class that defines the body properties structure.
 * @param options - Additional options, like the type.
 */
export function Body(modelClass: Newable<unknown>, options: BodyMetadataInput = {}): ParameterDecorator {
    return (target, propertyKey, index) => {
        const fullMetadata: BodyMetadata = {
            index,
            modelClass,
            isArray: false,
            required: true,
            description: undefined,
            type: MimeType.JSON,
            cleanupAfterMs: Ms.DAY,
            maxSize: resolveMaxBodySize(modelClass, options.baseMaxSize),
            allowAdditionalProperties: false,
            ...options
        };
        if ('baseMaxSize' in fullMetadata) {
            delete fullMetadata.baseMaxSize;
        }
        const ctor: Function = target.constructor;
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(ctor, stack);
        const key: string = propertyKey?.toString() ?? '';
        MetadataUtilities.setRouteBody(ctor, fullMetadata, key);
    };
}

// eslint-disable-next-line jsdoc/require-jsdoc
export function resolveMaxBodySize(modelClass: Newable<unknown>, baseMaxSize: FileSize = '100kb'): BigNumber {
    const bytes: BigNumber = fileSizeToBytes(baseMaxSize);
    const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(modelClass);
    return resolveMaxSize(bytes, properties);
}

// eslint-disable-next-line jsdoc/require-jsdoc
function resolveMaxSize(bytes: BigNumber, properties: Record<string, PropertyMetadata>): BigNumber {
    for (const key in properties) {
        const property: PropertyMetadata = properties[key];
        switch (property.type) {
            case 'file': {
                bytes = bytes.plus(fileSizeToBytes(property.maxSize));
                break;
            }
            case 'array': {
                if (property.items.type === 'file') {
                    bytes = bytes.plus(fileSizeToBytes(property.totalMaxSize));
                }
                break;
            }
            case 'object': {
                const objectProperties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(property.cls());
                bytes = bytes.plus(resolveMaxSize(bytes, objectProperties));
                break;
            }
            case Relation.ONE_TO_ONE: { throw new Error('Not implemented yet: Relation.ONE_TO_ONE case'); }
            case Relation.ONE_TO_MANY: { throw new Error('Not implemented yet: Relation.ONE_TO_MANY case'); }
            case Relation.MANY_TO_ONE: { throw new Error('Not implemented yet: Relation.MANY_TO_ONE case'); }
            case Relation.MANY_TO_MANY: { throw new Error('Not implemented yet: Relation.MANY_TO_MANY case'); }
            case 'string':
            case 'number':
            case 'boolean':
            case 'date':
            case 'unknown': {
                break;
            }
        }
    }
    return bytes;
}