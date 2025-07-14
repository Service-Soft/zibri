import { BasePropertyMetadata } from '../../entity/models/base-property-metadata.model';
import { MimeType } from '../../http';
import { Newable, OmitStrict } from '../../types';
import { MetadataUtilities, Ms } from '../../utilities';

/**
 * Base metadata shared by all possible http request body properties.
 */
type BaseBodyMetadata = BasePropertyMetadata & {
    /**
     * The class that defines the structure of the body metadata.
     */
    modelClass: Newable<unknown>,
    /**
     * The index at which the body parameter is provided in the controller method.
     */
    index: number
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
export type BodyMetadataInput = Partial<OmitStrict<BodyMetadata, 'modelClass' | 'index'>>;

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
            required: true,
            description: undefined,
            type: MimeType.JSON,
            cleanupAfterMs: Ms.DAY,
            ...options
        };
        const ctor: Function = target.constructor;
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(ctor, stack);
        const key: string = propertyKey?.toString() ?? '';
        MetadataUtilities.setRouteBody(ctor, fullMetadata, key);
    };
}