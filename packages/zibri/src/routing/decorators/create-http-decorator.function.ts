import { HttpMethod } from '../../http/http-method.enum.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { Route, ControllerRouteConfiguration } from '../controller-route-configuration.model.ts';
import { BaseHttpDecoratorInput } from './http-decorator-option-input.model.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
export function createHttpDecorator(method: HttpMethod, path: Route, options: BaseHttpDecoratorInput): MethodDecorator {
    return (target, propertyKey) => {
        const ctor: Function = target.constructor;
        MetadataUtilities.setFilePath(ctor);
        const routes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(ctor);
        routes.push({
            httpMethod: method,
            route: path,
            controllerMethod: propertyKey.toString(),
            versions: options.versions,
            timeoutInMs: options.timeoutInMs
        });
        MetadataUtilities.setControllerRoutes(ctor, routes);
    };
}