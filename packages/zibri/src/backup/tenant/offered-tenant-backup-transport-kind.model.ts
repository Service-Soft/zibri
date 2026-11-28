import { type TenantBackupTransportKindModel } from 'zibri-contract';

import { Property } from '../../entity/decorators/property.decorator';

/**
 * A kind of storage `BACKUP_TENANT_TRANSPORT_OPTIONS` lets tenants keep their backups on, as `GET /kinds` of the
 * `TenantBackupTransportController` answers it.
 */
export class OfferedTenantBackupTransportKind implements TenantBackupTransportKindModel {
    /**
     * The name of the kind, such as `'s3'`.
     */
    @Property.string()
    name!: string;
}
