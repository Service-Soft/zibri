import { BaseTenantEntity } from '../../entity/base-tenant-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { TenantBackupRetention } from './tenant-backup-retention.model';

/**
 * How a tenant's backups are kept, one row per tenant.
 */
// declared only by an application whose tenants keep a retention of their own
@Entity({ uniques: [['tenantId']], allowOrphan: true })
export class TenantBackupSettings extends BaseTenantEntity() {
    /**
     * The retention of the tenant's backups, or null for the application's.
     */
    @Property.object({ cls: () => TenantBackupRetention, required: false })
    retention?: TenantBackupRetention | null;
}