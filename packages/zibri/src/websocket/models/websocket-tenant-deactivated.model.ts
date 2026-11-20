/**
 * What the connections in a tenant are sent once it is deactivated, before they leave it.
 */
export type WebsocketTenantDeactivated = {
    /**
     * The tenant. Messages naming it are refused from now on.
     */
    tenantId: string
};