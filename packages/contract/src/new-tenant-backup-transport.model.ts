/**
 * Storage of the tenant to keep its backups on, as `POST /` of the routes of the backup transports takes it. It is
 * added once a small file was written to it and deleted again.
 */
export type NewTenantBackupTransportModel = {
    /**
     * What the tenant calls it, such as `Our bucket`, unique within the tenant.
     */
    name: string,
    /**
     * The name of its kind, one of those `GET /kinds` answers, such as `'s3'`.
     */
    kind: string,
    /**
     * What the tenant configures, as the settings of the kind describe them, such as a
     * {@link TenantS3TransportSettingsModel} for `'s3'`.
     */
    settings: Record<string, unknown>,
    /**
     * The secret it logs in with, as the secret of the kind describes it, such as a {@link TenantS3TransportSecretModel}
     * for `'s3'`. Stored encrypted, and never answered.
     */
    secret: Record<string, unknown>
};
