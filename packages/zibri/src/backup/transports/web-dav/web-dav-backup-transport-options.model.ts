import { WebDavConnection } from '../../../web-dav/web-dav-connection.model';
import { TenantTransportNetwork } from '../../tenant/tenant-transport-network.model';

/**
 * Where and how a WebDAV backup transport stores backups: `folder` below the url of `connection`.
 */
export type WebDavBackupTransportOptions = {
    /**
     * The folder of the server every path is relative to, and who logs in to it.
     */
    connection: WebDavConnection,
    /**
     * The folder the backups are kept in, relative to the url of the connection, such as `Backups/production`, or
     * `''` for the folder of the connection itself. Created with the folders above it when it does not exist.
     */
    folder: string,
    /**
     * What the host of the connection, and of every redirect, is checked by: the network of a tenant's transport, or
     * undefined for a server the application configures itself.
     */
    // required although undefined is one of its values, as WebDavClientOptions has it: "a tenant gave us this url"
    // and "we did" are two legitimate answers
    network: TenantTransportNetwork | undefined,
    /**
     * How long one request may take, its answer included. Five minutes by default.
     */
    timeoutInMs?: number,
    /**
     * How often a request is attempted, for a failure another attempt can help. 3 by default.
     */
    attempts?: number
};
