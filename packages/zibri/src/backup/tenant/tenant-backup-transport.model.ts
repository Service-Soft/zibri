import { BaseTenantEntity } from '../../entity/base-tenant-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * A transport a tenant configured for its own backups: storage of one of the kinds
 * `BACKUP_TENANT_TRANSPORT_OPTIONS` lists, such as a bucket or an SFTP server.
 */
// declared only by an application whose tenants configure transports of their own
@Entity({ uniques: [['name']], allowOrphan: true })
export class TenantBackupTransport extends BaseTenantEntity() {
    /**
     * What the tenant calls it, unique within the tenant.
     */
    @Property.string()
    name!: string;

    /**
     * The name of its kind, such as `'s3'` or `'sftp'`.
     */
    @Property.string()
    kind!: string;

    /**
     * What the tenant configured, as the `settingsModel` of its kind describes it.
     */
    @Property.unknown()
    settings!: Record<string, unknown>;

    /**
     * The secret it logs in with, as JSON, as the `secretModel` of its kind describes it. Encrypted, and bound
     * to the row.
     */
    @Property.string({ encryption: true, exclude: true })
    secret!: string;
}

/**
 * What configures a tenant's transport, its secret as it is.
 */
export type TenantBackupTransportCreateData = OmitStrict<TenantBackupTransport, 'id' | 'tenantId' | 'secret'> & {
    /**
     * The secret it logs in with, as the `secretModel` of its kind describes it.
     */
    secret: Record<string, unknown>
};