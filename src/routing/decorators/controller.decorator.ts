import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
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
 * Marks a controller class to be registered under the provided base route.
 * @param baseRoute - The base route of the controller. Any endpoints inside this class will be prefixed with this.
 * @param options - Additional options for the controller.
 */
export function Controller(baseRoute: Route, options: Partial<OmitStrict<ControllerData, 'baseRoute'>> = {}): ClassDecorator {
    const { allowOrphan = false, versions = ['^latest'] } = options;
    return target => {
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        MetadataUtilities.setControllerData(target, {
            baseRoute,
            allowOrphan,
            versions
        });
        GlobalRegistry.injectables.push({
            token: target as unknown as Newable<unknown>,
            useClass: target as unknown as Newable<unknown>
        });
        GlobalRegistry.controllerClasses.push(target as unknown as Newable<unknown>);
    };
}