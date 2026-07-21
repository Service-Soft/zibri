import { Injectable, InjectableOptions } from '../../di/decorators/injectable.decorator';
import { DiVariants } from '../../di/models/di-variant.model';
import { OmitStrict } from '../../types/omit-strict.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { SupportedVersionsOptions } from '../../versioning/supported-versions-options.model';
import { Route } from '../controller-route-configuration.model';

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
    allowOrphan: boolean
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
    const { allowOrphan = false, versions = ['^latest'] } = options;
    return target => {
        Injectable({ ...options, variant: DiVariants.CONTROLLER })(target);
        MetadataUtilities.setControllerData(target, {
            baseRoute,
            allowOrphan,
            versions
        });
    };
}