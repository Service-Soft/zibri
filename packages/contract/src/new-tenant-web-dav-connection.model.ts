import { type WebDavConnectionKind } from './web-dav-connection-kind.enum';

/**
 * A connection of a tenant to a folder of a WebDAV server to add, as `POST /` of the routes of the WebDAV connections
 * takes it. It is added once a request to the folder succeeds with it.
 */
export type NewTenantWebDavConnectionModel = {
    /**
     * What the tenant calls it, such as `Nextcloud`, unique within the tenant.
     */
    name: string,
    /**
     * What server it reaches: any WebDAV server, or a Nextcloud, whose url is below `/remote.php/dav/`.
     */
    kind: WebDavConnectionKind,
    /**
     * The url of the folder every path is relative to, such as `https://cloud.example.com/remote.php/dav/`.
     */
    url: string,
    /**
     * The name of the user logging in.
     */
    username: string,
    /**
     * The password of the user, such as an app password of Nextcloud. Stored, and never answered.
     */
    password: string
};