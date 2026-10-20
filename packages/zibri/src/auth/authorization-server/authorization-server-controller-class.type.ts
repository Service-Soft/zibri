import { AuthorizationServerControllerOptions } from './authorization-server-controller-options.model.ts';
import { AuthorizationServerEndpoint } from './authorization-server-endpoint.model.ts';
import { Newable } from '../../types/newable.type.ts';

/**
 * A controller class defined by `AuthorizationServerController`.
 */
export type AuthorizationServerControllerClass = Newable<object> & {
    /**
     * What the routes allow, which also marks the class as the authorization server's.
     */
    authorizationServerOptions: AuthorizationServerControllerOptions<string>,
    /**
     * Where the routes answer, and what they allow.
     */
    resolveEndpoint: () => AuthorizationServerEndpoint
};