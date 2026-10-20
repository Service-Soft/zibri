import { Request, Response } from 'express';

import { RouteConfiguration, RouteConfigurationInput } from './route-configuration.model.ts';
import { HttpMethod } from '../http/http-method.enum.ts';
import { Newable } from '../types/newable.type.ts';
import { BodyMetadata, DeclaredBodyInput } from './decorators/body-metadata.model.ts';
import { PathParamMetadataInput, QueryParamMetadataInput, HeaderParamMetadataInput, PathParamMetadata, QueryParamMetadata, HeaderParamMetadata } from './decorators/param.decorator.ts';

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
    registerRoute: <
        BodyMetaInputObject extends DeclaredBodyInput,
        PathMetaInputObject extends Record<string, PathParamMetadataInput>,
        QueryMetaInputObject extends Record<string, QueryParamMetadataInput>,
        HeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>
    >(
        route: RouteConfigurationInput<BodyMetaInputObject, PathMetaInputObject, QueryMetaInputObject, HeaderMetaInputObject>,
        // eslint-disable-next-line typescript/no-explicit-any
        ...params: any[]
    ) => void,

    /**
     * The origins whose pages may send the request with cookies, as the route it reaches declares
     * them with `@AcceptCrossSitePosts`. Empty when that route declares none.
     */
    resolveAcceptedCrossSiteOrigins: (request: Request, response: Response) => Promise<string[]>,

    /**
     * The methods the routes matching a path declare, eg. `/auth/federated/google/callback` for a route
     * `/auth/federated/:provider/callback`. None when no route matches it.
     */
    findMethods: (path: string) => HttpMethod[],

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