import { RouteConfiguration, RouteConfigurationInput } from './route-configuration.model';
import { Newable } from '../types/newable.type';
import { BodyMetadataInput, BodyMetadata } from './decorators/body.decorator';
import { PathParamMetadataInput, QueryParamMetadataInput, HeaderParamMetadataInput, PathParamMetadata, QueryParamMetadata, HeaderParamMetadata } from './decorators/param.decorator';

/**
 * Interface for a router.
 */
export interface RouterInterface {
    /**
     * Register a controller.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    registerController: (controllerClass: Newable<unknown>, ...params: any[]) => void | Promise<void>,

    /**
     * Register a route.
     */
    registerRoute: <
        // eslint-disable-next-line jsdoc/require-jsdoc
        BodyMetaInputObject extends BodyMetadataInput & { modelClass: Newable<unknown> },
        PathMetaInputObject extends Record<string, PathParamMetadataInput>,
        QueryMetaInputObject extends Record<string, QueryParamMetadataInput>,
        HeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>
    >(
        route: RouteConfigurationInput<BodyMetaInputObject, PathMetaInputObject, QueryMetaInputObject, HeaderMetaInputObject>,
        // eslint-disable-next-line typescript/no-explicit-any
        ...params: any[]
    ) => void | Promise<void>,

    /**
     * All routes that have been manually registered by calling the .register method.
     */
    manuallyRegisteredRoutes: RouteConfiguration<
        BodyMetadata,
        Record<string, PathParamMetadata>,
        Record<string, QueryParamMetadata>,
        Record<string, HeaderParamMetadata>
    >[]
}