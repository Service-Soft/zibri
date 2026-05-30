import { HttpMethod } from '../../http/http-method.enum';
import { Route } from '../controller-route-configuration.model';
import { createHttpDecorator } from './create-http-decorator.function';
import { BaseHttpDecoratorInput } from './http-decorator-option-input.model';

/**
 * Http PATCH endpoint.
 * @param path - The path of the endpoint, defaults to '/'.
 * @param options - Additional options, like eg. The supported versions.
 */
export function Patch(path: Route = '/', options: BaseHttpDecoratorInput = {}): MethodDecorator {
    return createHttpDecorator(HttpMethod.PATCH, path, options.versions);
}