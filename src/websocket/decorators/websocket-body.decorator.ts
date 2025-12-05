import { FileSize } from '../../entity/models/file-property-metadata.model';
import { MimeType } from '../../http';
import { JsonBodyMetadata, resolveMaxBodySize } from '../../routing';
import { Newable, OmitStrict } from '../../types';
import { MetadataUtilities } from '../../utilities';

/**
 * Metadata Input for websocket request bodies.
 */
export type WebsocketBodyMetadataInput = Partial<OmitStrict<JsonBodyMetadata, 'modelClass' | 'index' | 'type' | 'maxSize'>> & {
    /**
     * The base maximum size of the body.
     *
     * This is IN ADDITION to any file properties on the request body.
     */
    baseMaxSize?: FileSize
};

// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines a websocket request body property with the given data.
 * @param modelClass - The model class that defines the websocket request body properties structure.
 * @param options - Additional options, eg. If it's required etc.
 */
export function WebsocketBody(
    modelClass: Newable<unknown>,
    options: WebsocketBodyMetadataInput = {}
): ParameterDecorator {
    return (target, propertyKey, index) => {
        const fullMetadata: JsonBodyMetadata = {
            index,
            modelClass,
            required: true,
            description: undefined,
            type: MimeType.JSON,
            maxSize: resolveMaxBodySize(modelClass, options.baseMaxSize),
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