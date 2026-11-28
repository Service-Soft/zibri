import { type TenantBackupTransportChangeModel } from 'zibri-contract';

import { Property } from '../../entity/decorators/property.decorator';
import { ZIBRI_BACKUP_TRANSPORT_LIMITS } from './tenant-backup-transport-limits.model';

/**
 * A change of storage the tenant keeps its backups on, as `PATCH /:transportId` of the
 * `TenantBackupTransportController` takes it. Each property is unchanged when absent, and replaced as a whole when
 * given.
 */
export class TenantBackupTransportChange implements TenantBackupTransportChangeModel {
    /**
     * What the tenant calls it, unique within the tenant.
     */
    @Property.string({ minLength: 1, maxLength: ZIBRI_BACKUP_TRANSPORT_LIMITS.NAME_MAX_LENGTH, required: false })
    name?: string;

    /**
     * What the tenant configures, as the `settingsModel` of its kind describes it, all of it.
     */
    // unknown here, and checked against the model of the kind by the backup service, which only the transport names
    @Property.unknown({ required: false })
    settings?: Record<string, unknown>;

    /**
     * The secret it logs in with, as the `secretModel` of its kind describes it, all of it.
     */
    @Property.unknown({ required: false })
    secret?: Record<string, unknown>;
}
