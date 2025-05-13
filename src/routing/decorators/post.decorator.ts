import { HttpMethod } from '../../http/http-method.enum';
import { Route } from '../controller-route-configuration.model';
import { createHttpDecorator } from './create-http-decorator.function';

export function Post(path: Route = '/'): MethodDecorator {
    return createHttpDecorator(HttpMethod.POST, path);
}