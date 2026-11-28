import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { BaseAnalyticsRecord } from './base-analytics-record.model';

/**
 * A page view the analytics plugin counts.
 */
// a row belongs to the tenant of its site, or to none, and is written and read across tenants: a page view arrives
// from a visitor who names no tenant, and its site says whose it is. Every query reads a range of days of the sites of
// a tenant, or of one of them, which the index answers, the tenant first as on every entity with a tenant
@Entity({ allowOrphan: true, indexes: [['day', 'domain']] })
export class AnalyticsPageViewRecord extends BaseAnalyticsRecord {
    /**
     * Whether it is the first page view of its visit.
     */
    @Property.boolean()
    entry!: boolean;

    /**
     * Whether it is the first page view kept of its visitor. Null without a visitor.
     */
    @Property.boolean({ required: false })
    firstVisit?: boolean | null;
}