
import { OpenApiDefinition } from './open-api.model.ts';
import { ZibriApplication } from '../application/application.ts';
import { Route } from '../routing/controller-route-configuration.model.ts';
import { Version } from '../versioning/version.model.ts';

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