import { HttpMethod } from '../../http/http-method.enum';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { SupportedVersionsOptions } from '../../versioning/supported-versions-options.model';
import { Route, ControllerRouteConfiguration } from '../controller-route-configuration.model';

// eslint-disable-next-line jsdoc/require-jsdoc
export function createHttpDecorator(method: HttpMethod, path: Route, versions: SupportedVersionsOptions | undefined): MethodDecorator {
    return (target, propertyKey) => {
        const ctor: Function = target.constructor;
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(ctor, stack);
        const routes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(ctor);
        routes.push({ httpMethod: method, route: path, controllerMethod: propertyKey.toString(), versions });
        MetadataUtilities.setControllerRoutes(ctor, routes);
    };
}