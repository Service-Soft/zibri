import { Newable } from '../types';
import { RouteConfiguration } from './route-configuration.model';
import { ZibriApplication } from '../application';

export interface RouterInterface {
    // eslint-disable-next-line typescript/no-explicit-any
    registerController: <T extends Object>(controllerClass: Newable<T>, ...params: any[]) => void,
    // eslint-disable-next-line typescript/no-explicit-any
    register: (route: RouteConfiguration, ...params: any[]) => void,
    // eslint-disable-next-line typescript/no-explicit-any
    attachTo: (app: ZibriApplication, ...params: any[]) => void
}