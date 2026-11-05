import { ControllerData } from './decorators/controller.decorator';
import { InternalError } from '../error-handling/internal-error.model';
import { GlobalRegistry } from '../global/global-registry';
import { MetadataUtilities } from '../utilities/metadata.utilities';

/**
 * Utilities for the controllers of an application.
 */
export abstract class ControllerUtilities {
    /**
     * Where the routes of a controller answer: the application's `baseUrl`, followed by the path of
     * the controller. A class extending a controller answers at its own path when it declares one.
     * @param controller - The controller class.
     * @returns The url, without a trailing slash.
     * @throws An InternalError when the application has no `baseUrl` yet, or the class is no controller.
     */
    static resolveUrl(controller: Function): string {
        const baseUrl: string | undefined = GlobalRegistry.getAppData('baseUrl');
        if (baseUrl == undefined) {
            throw new InternalError(`The url of ${controller.name} starts with the baseUrl of the application, which is not set.`);
        }
        const data: ControllerData | undefined = MetadataUtilities.getControllerData(controller);
        if (data == undefined) {
            throw new InternalError(`${controller.name} is no controller, so it has no url.`);
        }
        return `${baseUrl.replace(/\/+$/, '')}${data.baseRoute === '/' ? '' : data.baseRoute}`;
    }
}