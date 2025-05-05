import { RouteConfiguration } from './route-configuration.model';

export interface RouterInterface {
    /**
     * Registers the given route to be used by the application.
     * @param route - The route to register.
     */
    register: (route: RouteConfiguration) => void
}