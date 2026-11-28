import { TenantTransportNetwork } from '../backup/tenant/tenant-transport-network.model';
import { WebDavConnection } from './web-dav-connection.model';

/**
 * What a `WebDavClient` connects to, how its hosts are checked, and how its requests are sent.
 */
export type WebDavClientOptions = {
    /**
     * The folder, and who logs in to it.
     */
    connection: WebDavConnection,
    /**
     * What the host of the connection, and of every redirect, is checked by: the network of a tenant's connection,
     * or undefined for a connection the application configures itself.
     */
    // required although undefined is one of its values: "a tenant gave us this url" and "we did" are two
    // legitimate answers, and forgetting to say must not read as the trusting one
    network: TenantTransportNetwork | undefined,
    /**
     * How long one request may take, its answer included. The timeout of the http client by default.
     */
    timeoutInMs?: number,
    /**
     * How often a request is attempted, for a failure another attempt can help. Once by default. A put under
     * `ifMatch` or `ifNoneMatch` is sent once, whatever this says.
     */
    attempts?: number
};
