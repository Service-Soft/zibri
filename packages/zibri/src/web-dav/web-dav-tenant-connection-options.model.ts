/**
 * What the WebDAV connections of tenants may reach.
 */
export type WebDavTenantConnectionOptions = {
    /**
     * The hosts a tenant's connection may reach, each with the hosts below it, or undefined for any public host. A
     * host leading to this machine or a private network is refused either way.
     */
    allowedHosts: string[] | undefined,
    /**
     * Whether a tenant's connection may reach this machine's networks, and a server over plain http, for a
     * deployment whose tenants keep their servers inside the network it runs in.
     */
    allowPrivateNetworks: boolean
};
