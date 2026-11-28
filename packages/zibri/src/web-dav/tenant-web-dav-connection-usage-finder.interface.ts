import { type TranslatedString } from '../localization/models/translated-string.model';
import { type TenantWebDavConnection } from './tenant-web-dav-connection.model';

/**
 * Interface for what finds where a feature uses a connection of a tenant to a WebDAV server, such as the calendar of
 * a project. A connection that is used is not deleted by `deleteConnection` of the `TenantWebDavConnectionService`.
 * Provide each with the variant `DiVariants.WEB_DAV_CONNECTION_USAGE_FINDER`. Rows that only point at a connection, and
 * can go with it, are removed by a `TenantWebDavConnectionUsageCleanerInterface` instead.
 */
export interface TenantWebDavConnectionUsageFinderInterface {
    /**
     * Finds where a connection is used, in the tenant it belongs to.
     * @param connection - The connection.
     * @returns A sentence for each use, such as `It is the calendar of the project Website.`, or none.
     */
    findUsages: (connection: TenantWebDavConnection) => Promise<TranslatedString[]>
}