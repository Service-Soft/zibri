
import { Newable } from '../types';
import { RouteConfiguration, RouteConfigurationInput } from './route-configuration.model';
import { ZibriApplication } from '../application';
import { HeaderParamMetadata, HeaderParamMetadataInput, PathParamMetadata, PathParamMetadataInput, QueryParamMetadata, QueryParamMetadataInput } from './decorators';

/**
 * Interface for a router.
 */
export interface RouterInterface {
    /**
     * Register a controller.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    registerController: (controllerClass: Newable<unknown>, ...params: any[]) => void,

    /**
     * Register a route.
     */
    register: <
        T extends Newable<unknown>,
        PathMetaInputObject extends Record<string, PathParamMetadataInput>,
        QueryMetaInputObject extends Record<string, QueryParamMetadataInput>,
        HeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>
    // eslint-disable-next-line typescript/no-explicit-any
    >(route: RouteConfigurationInput<T, PathMetaInputObject, QueryMetaInputObject, HeaderMetaInputObject>, ...params: any[]) => void,

    /**
     * Initializes the router, registers controllers etc.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    init: (app: ZibriApplication, ...params: any[]) => void,

    /**
     * Attaches the router to the app.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    attachTo: (app: ZibriApplication, ...params: any[]) => void,

    /**
     * All routes that have been manually registered by calling the .register method.
     */
    manuallyRegisteredRoutes: RouteConfiguration<
        Newable<unknown>,
        Record<string, PathParamMetadata>,
        Record<string, QueryParamMetadata>,
        Record<string, HeaderParamMetadata>
    >[]
}