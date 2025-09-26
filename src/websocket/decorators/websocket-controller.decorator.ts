import { GlobalRegistry } from '../../global';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';

/**
 * Data of a websocket controller.
 */
export type WebsocketControllerData = {};

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks a websocket controller class to be registered.
 */
export function WebsocketController(): ClassDecorator {
    return target => {
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        MetadataUtilities.setWebsocketController(target, {});
        GlobalRegistry.injectables.push({
            token: target as unknown as Newable<unknown>,
            useClass: target as unknown as Newable<unknown>
        });
        GlobalRegistry.websocketControllerClasses.push(target as unknown as Newable<unknown>);
    };
}