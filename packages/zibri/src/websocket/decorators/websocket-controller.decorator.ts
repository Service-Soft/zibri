import { Injectable, InjectableOptions } from '../../di/decorators/injectable.decorator.ts';
import { DiVariants } from '../../di/models/di-variant.model.ts';
import { HandlerTimeout } from '../../http/handler-timeout.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { SupportedVersionsOptions } from '../../versioning/supported-versions-options.model.ts';

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
    versions: SupportedVersionsOptions,
    /**
     * How long the handlers of this controller's events have to produce a result.
     *
     * Overrides the application's `handlerInMs` for every event on it, and an event overrides this
     * with its own `timeoutInMs`.
     */
    timeoutInMs: HandlerTimeout | undefined
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
    const { allowOrphan = false, versions = ['^latest'], eventPrefix = '', timeoutInMs } = options;
    return target => {
        Injectable({ ...options, variant: DiVariants.WEBSOCKET_CONTROLLER })(target);
        MetadataUtilities.setWebsocketControllerData(target, { allowOrphan, versions, eventPrefix, timeoutInMs });
    };
}