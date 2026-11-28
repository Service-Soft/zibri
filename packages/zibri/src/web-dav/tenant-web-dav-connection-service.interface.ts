import { type NewTenantWebDavConnection } from './new-tenant-web-dav-connection.model';
import { type TenantWebDavConnectionChange } from './tenant-web-dav-connection-change.model';
import { type TenantWebDavConnectionTest } from './tenant-web-dav-connection-test.model';
import { type TenantWebDavConnection } from './tenant-web-dav-connection.model';

/**
 * Interface for the service managing the connections of the active tenant to WebDAV servers, as the routes of the
 * `TenantWebDavConnectionController` call it.
 */
export interface TenantWebDavConnectionServiceInterface {
    /**
     * Finds the connections of the tenant.
     * @returns The connections, by name.
     */
    findConnections: () => Promise<TenantWebDavConnection[]>,
    /**
     * Adds a connection, once a request to its folder succeeds.
     * @param connection - The connection.
     * @returns The connection.
     * @throws {BadRequestError} When the request to its folder fails, saying why.
     * @throws {UniqueConstraintViolationError} When another connection of the tenant has its name.
     */
    createConnection: (connection: NewTenantWebDavConnection) => Promise<TenantWebDavConnection>,
    /**
     * Changes a connection. A change of its kind, url, username or password is made once a request to its folder
     * succeeds.
     * @param connectionId - The id of the connection.
     * @param change - The change.
     * @returns The connection.
     * @throws {BadRequestError} When the request to its folder fails, saying why.
     */
    updateConnection: (connectionId: string, change: TenantWebDavConnectionChange) => Promise<TenantWebDavConnection>,
    /**
     * Deletes a connection nothing uses, in one transaction with the rows that only point at it, such as the links to
     * the events written through it. What was written through it stays on the server.
     * @param connectionId - The id of the connection.
     * @throws {ConflictError} When a feature uses it, naming where.
     */
    deleteConnection: (connectionId: string) => Promise<void>,
    /**
     * Validates that a connection of the tenant reaches a folder: its host may be reached, the url of a Nextcloud is
     * below `/remote.php/dav/`, and a request for the folder succeeds with its username and password.
     * @param connection - The connection.
     * @throws {BadRequestError} When it does not, saying why.
     */
    validateConnection: (connection: TenantWebDavConnectionTest) => Promise<void>
}
