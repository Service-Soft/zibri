/**
 * The settings of a tenant's transport of the kind `'web-dav'`: which WebDAV connection of the tenant its backups are
 * kept through, and the folder below it. Its secret is `{}`, as the password is the connection's.
 */
export type TenantWebDavTransportSettingsModel = {
    /**
     * The id of the WebDAV connection of the tenant, of the kind `WEB_DAV`.
     */
    connectionId: string,
    /**
     * The folder the backups are kept in, relative to the url of the connection, such as `Backups`, or `''` for the
     * folder of the connection itself.
     */
    folder: string
};