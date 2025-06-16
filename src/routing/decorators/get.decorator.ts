import { HttpMethod } from '../../http';
import { Route } from '../controller-route-configuration.model';
import { createHttpDecorator } from './create-http-decorator.function';

export function Get(path: Route = '/'): MethodDecorator {
    return createHttpDecorator(HttpMethod.GET, path);
}