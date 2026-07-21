
import { ZibriApplication } from '../application';
import { OpenApiDefinition } from './open-api.model';
import { Route } from '../routing/controller-route-configuration.model';
import { Version } from '../versioning/version.model';

/**
 * Interface for an open api service.
 */
export interface OpenApiServiceInterface {
    /**
     * The route where the open api explorer should be reached under.
     */
    readonly openApiRoute: Route,
    /**
     * Creates the open api definition.
     */
    createOpenApiDefinition: (app: ZibriApplication, version: Version) => OpenApiDefinition | Promise<OpenApiDefinition>
}