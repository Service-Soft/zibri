
import { ZibriApplication } from '../application';
import { Route } from '../routing';
import { OpenApiDefinition } from './open-api.model';

/**
 * Interface for an open api service.
 */
export interface OpenApiServiceInterface {
    /**
     * The route where the open api explorer should be reached under.
     */
    readonly openApiRoute: Route,
    /**
     * Attaches the service to the Zibri application.
     */
    attachTo: (app: ZibriApplication) => void,
    /**
     * Creates the open api definition.
     */
    createOpenApiDefinition: (app: ZibriApplication) => OpenApiDefinition
}