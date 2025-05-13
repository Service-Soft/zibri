import { Request, Response } from 'express';

import { Route } from './controller-route-configuration.model';
import { HttpMethod } from '../http/http-method.enum';

export type RouteConfiguration = {
    httpMethod: HttpMethod,
    route: Route,
    handler: (req: Request, res: Response) => unknown | Promise<unknown>
};