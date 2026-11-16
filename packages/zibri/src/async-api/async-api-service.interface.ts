import { AsyncApiDefinition } from './async-api.model';
import { ZibriApplication } from '../application/application';
import { Version } from '../versioning/version.model';

/**
 * Builds the AsyncAPI document of each version: the websocket events of the application.
 */
export interface AsyncApiServiceInterface {
    /**
     * Builds the document of one version.
     */
    createAsyncApiDefinition: (app: ZibriApplication, version: Version) => AsyncApiDefinition | Promise<AsyncApiDefinition>,
    /**
     * Finds the document of one version, built when the application started.
     */
    findAsyncApiDefinition: (version: string) => AsyncApiDefinition | undefined
}