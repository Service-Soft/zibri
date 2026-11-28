import { BaseTenantEntity } from '../../entity/base-tenant-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * A file store a tenant configured for its own files: storage of one of the kinds `FILE_TENANT_STORE_OPTIONS` lists,
 * such as a bucket or an SFTP server. Used for the tenant's files in place of the application's store of the same
 * name.
 */
// declared only by an application whose tenants configure file stores of their own
@Entity({ uniques: [['name']], allowOrphan: true })
export class TenantFileStore extends BaseTenantEntity() {
    /**
     * The name of the store it stands in for, such as `'documents'`, unique within the tenant.
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
 * What configures a tenant's file store, its secret as it is.
 */
export type TenantFileStoreCreateData = OmitStrict<TenantFileStore, 'id' | 'tenantId' | 'secret'> & {
    /**
     * The secret it logs in with, as the `secretModel` of its kind describes it.
     */
    secret: Record<string, unknown>
};