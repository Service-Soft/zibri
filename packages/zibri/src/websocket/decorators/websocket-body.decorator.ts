import { JsonBodyMetadata, JsonBodyMetadataInput, JsonBodyShapeMetadataInput, XmlBodyMetadata, XmlBodyMetadataInput } from '../../routing/decorators/body-metadata.model.ts';
import { resolveStructuredBodyMetadata } from '../../routing/resolve-body-metadata.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';

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
// oxlint-disable-next-line no-redeclare
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

// eslint-disable-next-line jsdoc-js/require-jsdoc
function setRouteBody(target: object, propertyKey: string | symbol | undefined, metadata: JsonBodyMetadata | XmlBodyMetadata): void {
    const ctor: Function = target.constructor;
    MetadataUtilities.setFilePath(ctor);
    const key: string = propertyKey?.toString() ?? '';
    MetadataUtilities.setRouteBody(ctor, metadata, key);
}