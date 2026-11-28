/**
 * A change of storage a tenant keeps its backups on, as `PATCH /:transportId` of the routes of the backup transports
 * takes it. Each property is unchanged when absent, and replaced as a whole when given. A change of the settings or the
 * secret is made once a small file was written with it and deleted again. The settings change only while no backup is
 * stored on the transport, as the backups stored on it would be lost with them. The kind never changes.
 */
export type TenantBackupTransportChangeModel = {
    /**
     * What the tenant calls it, unique within the tenant.
     */
    name?: string,
    /**
     * What the tenant configures, as the settings of its kind describe them, all of them.
     */
    settings?: Record<string, unknown>,
    /**
     * The secret it logs in with, as the secret of its kind describes it, all of it. Stored encrypted, and never
     * answered.
     */
    secret?: Record<string, unknown>
};
