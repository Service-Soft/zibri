import { type RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { type TenantWebDavConnection } from './tenant-web-dav-connection.model';

/**
 * Interface for what removes the rows of a feature that point at a connection of a tenant to a WebDAV server once the
 * connection is deleted, such as the links to the events written through it. Unlike a usage finder, it keeps no
 * connection from being deleted: `deleteConnection` of the `TenantWebDavConnectionService` runs every one in the
 * transaction the connection is deleted in. Provide each with the variant `DiVariants.WEB_DAV_CONNECTION_USAGE_CLEANER`.
 */
export interface TenantWebDavConnectionUsageCleanerInterface {
    /**
     * Removes the rows that point at a connection which is deleted. What they point at on the server stays there.
     * @param connection - The connection.
     * @param transaction - The transaction the connection is deleted in, which the rows are removed in.
     */
    removeUsages: (connection: TenantWebDavConnection, transaction: RepositoryTransaction) => Promise<void>
}