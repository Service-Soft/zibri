import { HttpMethod } from '../../http/http-method.enum.ts';
import { Route } from '../controller-route-configuration.model.ts';
import { createHttpDecorator } from './create-http-decorator.function.ts';
import { BaseHttpDecoratorInput } from './http-decorator-option-input.model.ts';

/**
 * Http POST endpoint.
 * @param path - The path of the endpoint, defaults to '/'.
 * @param options - Additional options, like eg. The supported versions.
 */
export function Post(path: Route = '/', options: BaseHttpDecoratorInput = {}): MethodDecorator {
    return createHttpDecorator(HttpMethod.POST, path, options);
}