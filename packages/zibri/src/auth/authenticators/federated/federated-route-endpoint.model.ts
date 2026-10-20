import { FederatedRoute } from './federated-route.type.ts';
import { HttpMethod } from '../../../http/http-method.enum.ts';

/**
 * A route whose url an authenticator gives out, and the method the browser requests that url with.
 */
export type FederatedRouteEndpoint = {
    /**
     * The route.
     */
    route: FederatedRoute,
    /**
     * The method: `GET` when the browser is sent to the url, `POST` when a page posts a form to it.
     */
    method: HttpMethod
};