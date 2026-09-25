import { JsonBodyMetadata, JsonBodyMetadataInput, JsonBodyShapeMetadataInput, XmlBodyMetadata, XmlBodyMetadataInput } from '../../routing/decorators/body-metadata.model';
import { resolveStructuredBodyMetadata } from '../../routing/resolve-body-metadata.function';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * Metadata Input for websocket request bodies, which are json (the default) or xml.
 */
export type WebsocketBodyMetadataInput = JsonBodyMetadataInput | XmlBodyMetadataInput;

/**
 * Metadata Input for websocket request bodies that are one of several shapes.
 */
export type OneOfWebsocketBodyMetadataInput = WebsocketBodyMetadataInput & {
    /**
     * The shapes the body can be. It becomes the first, in this order, that it fits.
     */
    shapes: JsonBodyShapeMetadataInput[]
};

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
        setRouteBody(target, propertyKey, resolveStructuredBodyMetadata({ ...options, modelClass }, index));
    };
}

/**
 * Bundles the other ways of defining a websocket request body.
 */
// eslint-disable-next-line typescript/no-namespace
export namespace WebsocketBody {
    /**
     * Defines a websocket request body property that is one of several shapes.
     * @param data - The shapes, and additional options like whether it is required.
     */
    export function oneOf(data: OneOfWebsocketBodyMetadataInput): ParameterDecorator {
        const withoutIndex: JsonBodyMetadata | XmlBodyMetadata = resolveStructuredBodyMetadata(data, 0);
        return (target, propertyKey, index) => {
            setRouteBody(target, propertyKey, { ...withoutIndex, index });
        };
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function setRouteBody(target: Object, propertyKey: string | symbol | undefined, metadata: JsonBodyMetadata | XmlBodyMetadata): void {
    const ctor: Function = target.constructor;
    // eslint-disable-next-line unicorn/error-message
    const stack: string = new Error().stack ?? '';
    MetadataUtilities.setFilePath(ctor, stack);
    const key: string = propertyKey?.toString() ?? '';
    MetadataUtilities.setRouteBody(ctor, metadata, key);
}