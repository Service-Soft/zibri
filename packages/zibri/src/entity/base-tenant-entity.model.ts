import { BaseEntity } from './base-entity.model';
import { Property } from './decorators/property.decorator';

/**
 * The base of an entity whose rows each belong to one tenant: an id, and the tenant in `tenantId`,
 * which is where `@Entity()` reads it from.
 */
export class BaseTenantEntity extends BaseEntity {
    /**
     * The uuid of the tenant the row belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;
}
