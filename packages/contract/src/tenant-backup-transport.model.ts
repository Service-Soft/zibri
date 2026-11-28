/**
 * Storage a tenant keeps its backups on, such as a bucket or an SFTP server, as the routes of the backup transports
 * answer it. Its secret is never answered.
 */
export type TenantBackupTransportModel = {
    /**
     * The id of the transport.
     */
    id: string,
    /**
     * The tenant it belongs to.
     */
    tenantId: string,
    /**
     * What the tenant calls it, unique within the tenant.
     */
    name: string,
    /**
     * The name of its kind, such as `'s3'`, one of {@link ZIBRI_BACKUP_TRANSPORT_KINDS} or a kind of the application.
     */
    kind: string,
    /**
     * What the tenant configured, as the settings of its kind describe them, such as a
     * {@link TenantS3TransportSettingsModel} for `'s3'`.
     */
    settings: Record<string, unknown>
};
