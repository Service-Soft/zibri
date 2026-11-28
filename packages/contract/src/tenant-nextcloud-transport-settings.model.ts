/**
 * The settings of a tenant's transport of the kind `'nextcloud'`: which Nextcloud connection of the tenant its backups
 * are kept through, the folder below it, and who the folder is shared with to read. Its secret is `{}`, as the password
 * is the connection's.
 */
export type TenantNextcloudTransportSettingsModel = {
    /**
     * The id of the WebDAV connection of the tenant, of the kind `NEXTCLOUD`, logged in as the user owning the folder.
     */
    connectionId: string,
    /**
     * The folder the backups are kept in, relative to the url of the connection, such as `Backups`.
     */
    folder: string,
    /**
     * The ids of the users of the Nextcloud the folder is shared with, to read, empty for none.
     */
    sharedWithUsers: string[],
    /**
     * The ids of the groups of the Nextcloud the folder is shared with, to read, empty for none.
     */
    sharedWithGroups: string[]
};
