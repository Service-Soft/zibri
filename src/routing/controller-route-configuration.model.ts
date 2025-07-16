import { HttpMethod } from '../http/http-method.enum';

/**
 * Definition for a route used eg. By controllers.
 * Simply a string prefixed with '/'.
 */
export type Route = `/${string}`;

/**
 * The configuration for a controller route.
 */
export type ControllerRouteConfiguration = {
    /**
     * The http method used by the route.
     */
    httpMethod: HttpMethod,
    /**
     * The actual route under which the endpoint should be reached.
     */
    route: Route,
    /**
     * The name of the method on the controller that is responsible for handling requests to the endpoint.
     */
    controllerMethod: string
};