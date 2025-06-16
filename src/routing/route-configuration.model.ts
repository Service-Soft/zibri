import { Route } from './controller-route-configuration.model';
import { HttpRequest, HttpResponse } from '../http';
import { HttpMethod } from '../http/http-method.enum';

export type RouteConfiguration = {
    httpMethod: HttpMethod,
    route: Route,
    handler: (req: HttpRequest, res: HttpResponse) => unknown | Promise<unknown>
};