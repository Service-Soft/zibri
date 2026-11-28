import { AnyTenantFileStoreKind } from './tenant-file-store-kind.interface';

/**
 * What tenants may configure as file stores of their own.
 */
export type TenantFileStoreOptions = {
    /**
     * The kinds of storage a tenant may configure, such as `new S3TenantFileStoreKind()`.
     */
    kinds: AnyTenantFileStoreKind[],
    /**
     * The hosts a tenant's file store may reach, each with the hosts below it, or undefined for any public host. A
     * host leading to this machine or a private network is refused either way.
     */
    allowedHosts: string[] | undefined,
    /**
     * Whether a tenant's file store may reach this machine's networks and unencrypted protocols, such as a bucket
     * over plain http, for a deployment whose tenants keep their storage inside the network it runs in.
     */
    allowPrivateNetworks: boolean
};