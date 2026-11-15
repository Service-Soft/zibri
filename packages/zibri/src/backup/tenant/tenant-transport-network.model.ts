/**
 * What a transport of a tenant reaches the network through: the check of each host it connects to against
 * what `BACKUP_TENANT_TRANSPORT_OPTIONS` lets tenants reach.
 */
export type TenantTransportNetwork = {
    /**
     * Checks a host the transport is about to connect to, and resolves the address to connect to: a public
     * address of it, or the host itself where private networks are allowed. Called for every host the
     * transport connects to, before every session and for each redirect it follows.
     * @throws When the host leads to this machine or a private network, or is none of the allowed hosts.
     */
    resolveAddress: (host: string) => Promise<string>,
    /**
     * Whether a tenant's transport may reach this machine's networks, and unencrypted protocols such as plain http.
     */
    allowPrivateNetworks: boolean
};