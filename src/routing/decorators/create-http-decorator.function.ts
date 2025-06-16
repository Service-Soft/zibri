import { HttpMethod } from '../../http';
import { MetadataUtilities } from '../../utilities';
import { Route, ControllerRouteConfiguration } from '../controller-route-configuration.model';

export function createHttpDecorator(method: HttpMethod, path: Route): MethodDecorator {
    return (target, propertyKey) => {
        const ctor: Function = target.constructor;
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(ctor, stack);
        const routes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(ctor);
        routes.push({ httpMethod: method, route: path, controllerMethod: propertyKey.toString() });
        MetadataUtilities.setControllerRoutes(ctor, routes);
    };
}