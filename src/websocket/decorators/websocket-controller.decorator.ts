import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * Data of a websocket controller.
 */
export type WebsocketControllerData = {
    /**
     * Whether or not this websocket controller is allowed to exist without being registered in the application.
     */
    allowOrphan: boolean
};

/**
 * Marks a websocket controller class to be registered.
 * @param options - Options for the websocket controller.
 */
export function WebsocketController(options: Partial<WebsocketControllerData> = {}): ClassDecorator {
    const { allowOrphan = false } = options;
    return target => {
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        MetadataUtilities.setWebsocketControllerData(target, { allowOrphan });
        GlobalRegistry.injectables.push({
            token: target as unknown as Newable<unknown>,
            useClass: target as unknown as Newable<unknown>
        });
        GlobalRegistry.websocketControllerClasses.push(target as unknown as Newable<unknown>);
    };
}