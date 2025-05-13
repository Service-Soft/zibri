
import { ZibriApplication } from '../application';
import { Route } from '../routing';
import { OpenApiDefinition } from './open-api.model';

export interface OpenApiServiceInterface {
    readonly openApiRoute: Route,
    attachTo: (app: ZibriApplication) => void,
    createOpenApiDefinition: (app: ZibriApplication) => OpenApiDefinition
}