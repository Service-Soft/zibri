import { AnyTenantBackupTransportKind } from './tenant-backup-transport-kind.interface';

/**
 * What tenants may configure as transports of their own backups.
 */
export type TenantBackupTransportOptions = {
    /**
     * The kinds of storage a tenant may configure, such as `new S3TenantBackupTransportKind()`.
     */
    kinds: AnyTenantBackupTransportKind[],
    /**
     * The hosts a tenant's transport may reach, each with the hosts below it, or undefined for any public
     * host. A host leading to this machine or a private network is refused either way.
     */
    allowedHosts: string[] | undefined,
    /**
     * Whether a tenant's transport may reach this machine's networks and unencrypted protocols, such as a
     * bucket over plain http, for a deployment whose tenants keep their storage inside the network it runs in.
     */
    allowPrivateNetworks: boolean
};