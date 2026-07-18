import { Injectable, InjectableOptions } from '../../di/decorators/injectable.decorator';
import { DiVariants } from '../../di/models/di-variant.model';
import { OmitStrict } from '../../types/omit-strict.type';
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
 * Options input for the websocket controller.
 */
export type WebsocketControllerInputData<T> = OmitStrict<InjectableOptions<T>, 'variant'> & Partial<WebsocketControllerData>;

/**
 * Marks a websocket controller class to be registered.
 * @param options - Options for the websocket controller.
 */
export function WebsocketController<T>(options: WebsocketControllerInputData<T> = {}): ClassDecorator {
    const { allowOrphan = false, versions = ['^latest'], eventPrefix = '' } = options;
    return target => {
        Injectable({ ...options, variant: DiVariants.WEBSOCKET_CONTROLLER })(target);
        MetadataUtilities.setWebsocketControllerData(target, { allowOrphan, versions, eventPrefix });
    };
}