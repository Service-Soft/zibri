import { type NewTenantBackupTransportModel } from 'zibri-contract';

import { Property } from '../../entity/decorators/property.decorator';
import { ZIBRI_BACKUP_TRANSPORT_LIMITS } from './tenant-backup-transport-limits.model';

/**
 * Storage of the tenant to keep its backups on, as `POST /` of the `TenantBackupTransportController` takes it.
 */
export class NewTenantBackupTransport implements NewTenantBackupTransportModel {
    /**
     * What the tenant calls it, such as `Our bucket`, unique within the tenant.
     */
    @Property.string({ minLength: 1, maxLength: ZIBRI_BACKUP_TRANSPORT_LIMITS.NAME_MAX_LENGTH })
    name!: string;

    /**
     * The name of its kind, one of `BACKUP_TENANT_TRANSPORT_OPTIONS`, such as `'s3'`.
     */
    @Property.string({ minLength: 1 })
    kind!: string;

    /**
     * What the tenant configures, as the `settingsModel` of the kind describes it.
     */
    // unknown here, and checked against the model of the kind by the backup service, which only the kind names
    @Property.unknown()
    settings!: Record<string, unknown>;

    /**
     * The secret it logs in with, as the `secretModel` of the kind describes it.
     */
    @Property.unknown()
    secret!: Record<string, unknown>;
}
