import { HttpMethod } from '../http/http-method.enum';

export type Route = `/${string}`;

export type ControllerRouteConfiguration = {
    httpMethod: HttpMethod,
    route: Route,
    controllerMethod: string
};