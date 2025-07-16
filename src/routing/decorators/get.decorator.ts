import { HttpMethod } from '../../http';
import { Route } from '../controller-route-configuration.model';
import { createHttpDecorator } from './create-http-decorator.function';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Http GET endpoint.
 * @param path - The path of the endpoint, defaults to '/'.
 */
export function Get(path: Route = '/'): MethodDecorator {
    return createHttpDecorator(HttpMethod.GET, path);
}