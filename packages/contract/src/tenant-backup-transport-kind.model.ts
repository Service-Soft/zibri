/**
 * A kind of storage the application lets tenants keep their backups on, as `GET /kinds` of the routes of the backup
 * transports answers it.
 */
export type TenantBackupTransportKindModel = {
    /**
     * The name of the kind, such as `'s3'`, one of {@link ZIBRI_BACKUP_TRANSPORT_KINDS} or a kind of the application.
     */
    name: string
};
