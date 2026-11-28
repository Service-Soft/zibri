import { type WebDavConnectionKind } from './web-dav-connection-kind.enum';

/**
 * A connection of a tenant to a folder of a WebDAV server, such as its Nextcloud, as the routes of the WebDAV
 * connections answer it. Its password is never answered.
 */
export type TenantWebDavConnectionModel = {
    /**
     * The id of the connection.
     */
    id: string,
    /**
     * The tenant it belongs to.
     */
    tenantId: string,
    /**
     * What the tenant calls it, such as `Nextcloud`, unique within the tenant.
     */
    name: string,
    /**
     * What server it reaches: any WebDAV server, or a Nextcloud.
     */
    kind: WebDavConnectionKind,
    /**
     * The url of the folder every path is relative to, such as `https://cloud.example.com/remote.php/dav/`.
     */
    url: string,
    /**
     * The name of the user logging in.
     */
    username: string
};
