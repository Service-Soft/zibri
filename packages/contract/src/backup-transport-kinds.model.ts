/**
 * The names of the kinds of storage Zibri ships for the backups of a tenant: a bucket of an S3 compatible storage, an
 * SFTP server, a folder of a WebDAV server and one of a Nextcloud. The settings of each are described by
 * {@link TenantS3TransportSettingsModel}, {@link TenantSftpTransportSettingsModel},
 * {@link TenantWebDavTransportSettingsModel} and {@link TenantNextcloudTransportSettingsModel}.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_BACKUP_TRANSPORT_KINDS = {
    /**
     * A bucket of an S3 compatible storage, over https.
     */
    S3: 's3',
    /**
     * An SFTP server.
     */
    SFTP: 'sftp',
    /**
     * A folder of a WebDAV server, through a WebDAV connection of the tenant of the kind `WEB_DAV`.
     */
    WEB_DAV: 'web-dav',
    /**
     * A folder of a Nextcloud, through a WebDAV connection of the tenant of the kind `NEXTCLOUD`.
     */
    NEXTCLOUD: 'nextcloud'
} as const;
