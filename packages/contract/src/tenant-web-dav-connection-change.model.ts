import { type WebDavConnectionKind } from './web-dav-connection-kind.enum';

/**
 * A change of a connection of a tenant to a folder of a WebDAV server, as `PATCH /:connectionId` of the routes of the
 * WebDAV connections takes it. Each property is unchanged when absent. A change of the kind, the url, the username or
 * the password is made once a request to the folder succeeds with it.
 */
export type TenantWebDavConnectionChangeModel = {
    /**
     * What the tenant calls it, unique within the tenant.
     */
    name?: string,
    /**
     * What server it reaches.
     */
    kind?: WebDavConnectionKind,
    /**
     * The url of the folder every path is relative to.
     */
    url?: string,
    /**
     * The name of the user logging in.
     */
    username?: string,
    /**
     * The password of the user. Stored, and never answered.
     */
    password?: string
};
