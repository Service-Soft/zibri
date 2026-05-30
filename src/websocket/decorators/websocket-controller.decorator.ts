import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { SupportedVersionsOptions } from '../../versioning/supported-versions-options.model';

/**
 * Data of a websocket controller.
 */
export type WebsocketControllerData = {
    /**
     * A prefix that all events of the controller should have.
     * @default ''
     */
    eventPrefix: string,
    /**
     * Whether or not this websocket controller is allowed to exist without being registered in the application.
     */
    allowOrphan: boolean,
    /**
     * The versions that should be supported by this websocket controller's events. Can be overridden per event.
     */
    versions: SupportedVersionsOptions
};

/**
 * Marks a websocket controller class to be registered.
 * @param options - Options for the websocket controller.
 */
export function WebsocketController(options: Partial<WebsocketControllerData> = {}): ClassDecorator {
    const { allowOrphan = false, versions = ['^latest'], eventPrefix = '' } = options;
    return target => {
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        MetadataUtilities.setWebsocketControllerData(target, { allowOrphan, versions, eventPrefix });
        GlobalRegistry.injectables.push({
            token: target as unknown as Newable<unknown>,
            useClass: target as unknown as Newable<unknown>
        });
        GlobalRegistry.websocketControllerClasses.push(target as unknown as Newable<unknown>);
    };
}