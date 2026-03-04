import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * Metadata of the \@CurrentWebsocketConnection decorator.
 */
export type CurrentWebsocketConnectionMetadata = {
    /**
     * The index at which the parameter exists that should be injected as the currently logged in user.
     */
    index: number
};

/**
 * Marks the parameter to be injected as the currently connected websocket.
 */
export function CurrentWebsocketConnection(): ParameterDecorator {
    return (target, propertyKey, index) => {
        const fullMetadata: CurrentWebsocketConnectionMetadata = { index };
        const ctor: Function = target.constructor;
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(ctor, stack);
        const key: string = propertyKey?.toString() ?? '';
        MetadataUtilities.setRouteCurrentWebsocketConnection(ctor, fullMetadata, key);
    };
}