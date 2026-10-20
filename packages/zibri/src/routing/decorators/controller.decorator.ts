import { Injectable, InjectableOptions } from '../../di/decorators/injectable.decorator.ts';
import { DiVariants } from '../../di/models/di-variant.model.ts';
import { HandlerTimeout } from '../../http/handler-timeout.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { SupportedVersionsOptions } from '../../versioning/supported-versions-options.model.ts';
import { Route } from '../controller-route-configuration.model.ts';

/**
 * Data of a controller.
 */
export type ControllerData = {
    /**
     * The base route of the controller. Any endpoints inside this class will be prefixed with this.
     */
    baseRoute: Route,
    /**
     * The versions that should be supported by this controller's routes. Can be overridden per route.
     */
    versions: SupportedVersionsOptions,
    /**
     * Whether or not this controller is allowed to exist without being registered in the application.
     */
    allowOrphan: boolean,
    /**
     * How long the handlers of this controller's routes have to produce a result.
     *
     * Overrides the application's `handlerInMs` for every route on it, and a route overrides this
     * with its own `timeoutInMs`.
     */
    timeoutInMs: HandlerTimeout | undefined
};

/**
 * Options input for the controller.
 */
export type ControllerInputData<T> = OmitStrict<InjectableOptions<T>, 'variant'> & Partial<OmitStrict<ControllerData, 'baseRoute'>>;

/**
 * Marks a controller class to be registered under the provided base route.
 * @param baseRoute - The base route of the controller. Any endpoints inside this class will be prefixed with this.
 * @param options - Additional options for the controller.
 */
export function Controller<T>(baseRoute: Route, options: ControllerInputData<T> = {}): ClassDecorator {
    const { allowOrphan = false, versions = ['^latest'], timeoutInMs } = options;
    return target => {
        Injectable({ ...options, variant: DiVariants.CONTROLLER })(target);
        MetadataUtilities.setControllerData(target, {
            baseRoute,
            allowOrphan,
            versions,
            timeoutInMs
        });
    };
}