import { HttpRequest } from '../http/http-request.model';
import { Newable } from '../types/newable.type';
import { WebsocketRequest } from '../websocket/models/websocket-request.model';
import { type BaseTenantDefinition } from './tenant-definition/base-tenant-definition.model';
import { type TenantDeletion } from './tenant-definition/tenant-deletion.model';

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
    resolveTenantUrl: (url: string, tenantId: string) => string | Promise<string>,

    // TODO 4.0: the members below required, like the ones above. Optional while a tenant service of an application's
    // own may lack them
    /**
     * Gets the header resolveTenant reads the tenant of a request from, which browsers on another origin are allowed
     * to send. Undefined for a service that reads none, such as one reading the subdomain.
     */
    getTenantHeader?: () => string | undefined,

    /**
     * Finds a tenant by its id, in the entity of the tenants.
     * @returns The tenant, or undefined when there is none, or no entity of the tenants.
     */
    findTenant?: (tenantId: string) => Promise<BaseTenantDefinition | undefined>,

    /**
     * Resolves whether a tenant is deactivated. False for every tenant while the entity of the tenants is not
     * deactivatable, or there is none. Answered from memory, which a write of the tenant clears at once on the
     * instance writing it, and within a few seconds on every other.
     */
    resolveIsDeactivated?: (tenantId: string) => Promise<boolean>,

    /**
     * Refuses to start work for a tenant that is deactivated, such as queuing an email in it.
     * @param tenantId - The tenant the work is for, or undefined for work of no tenant, which is never refused.
     * @throws A TenantDeactivatedError when it is deactivated.
     */
    validateNotDeactivated?: (tenantId: string | undefined) => Promise<void>,

    /**
     * Finds the entity whose rows are the tenants, so that what follows them can observe its writes.
     * @returns The entity, undefined when the application declares none. Known once the application has initialized.
     */
    findTenantEntityClass?: () => Newable<BaseTenantDefinition> | undefined,

    /**
     * Deactivates a tenant: refuses every request for it from then on, deletes the work queued for it, such as its
     * emails, and has its websocket connections leave it.
     * @throws A NotFoundError when there is no such tenant, an InternalError when tenants are not deactivatable.
     */
    deactivateTenant?: (tenantId: string) => Promise<void>,

    /**
     * Reactivates a deactivated tenant, and lets the websocket connections of its members back in.
     * @throws Like `deactivateTenant`.
     */
    reactivateTenant?: (tenantId: string) => Promise<void>,

    /**
     * Starts deleting a deactivated tenant and every row that belongs to it, which goes on in the background, after
     * a crash too, until the tenant itself is gone. Starting it again answers the deletion that runs.
     * @returns The deletion, which `findTenantDeletion` reads the progress of.
     * @throws A NotFoundError when there is no such tenant, a BadRequestError when it is not deactivated.
     */
    deleteTenant?: (tenantId: string) => Promise<TenantDeletion>,

    /**
     * Finds the deletion of a tenant, with how far it got.
     * @returns The deletion, or undefined when none was started.
     */
    findTenantDeletion?: (tenantId: string) => Promise<TenantDeletion | undefined>,

    /**
     * Goes on with every tenant deletion that has not finished, such as after the instance running it stopped.
     * Called by `TenantDeletionCronJob`.
     */
    resumeTenantDeletions?: () => Promise<void>
}