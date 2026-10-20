import { HttpRequest } from '../http/http-request.model.ts';
import { WebsocketRequest } from '../websocket/models/websocket-request.model.ts';

/**
 * Interface for the service that says which tenant the running work acts in.
 */
export interface TenantServiceInterface {
    /**
     * Runs the given work as the given tenant.
     *
     * Everything inside it reaches that tenant's rows and no other's - what a cron job, an event
     * handler or a startup task uses to work on one tenant. A tenant set inside another replaces it
     * for as long as the inner work runs. A tenant id is a uuid, and any other value is refused.
     */
    runAs: <T>(tenantId: string, fn: () => Promise<T>) => Promise<T>,

    /**
     * Gets the tenant the running work acts in.
     *
     * Undefined when no tenant is active, which is the case outside every request and every `runAs`,
     * and in a request resolveTenant found no tenant for.
     */
    getActiveTenantId: () => string | undefined,

    /**
     * Finds the tenant a request is for.
     *
     * Asked once for every http request and every websocket message, before the access checks run. A
     * request it finds a tenant for acts in that tenant; a request it finds none for reaches only what
     * every tenant shares. A request naming a tenant that is not a uuid is refused with a 400.
     */
    resolveTenant: (request: HttpRequest | WebsocketRequest) => string | undefined | Promise<string | undefined>,

    /**
     * Puts a tenant into a link, so that a request following it is for that tenant.
     *
     * The counterpart of resolveTenant, for links a request cannot add a header to, such as one in an
     * email. Override both together, so that a link names its tenant the way a request is read.
     */
    resolveTenantUrl: (url: string, tenantId: string) => string | Promise<string>
}