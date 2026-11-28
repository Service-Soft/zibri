import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { BaseAnalyticsRecord } from './base-analytics-record.model';

/**
 * An event the analytics plugin counts.
 */
// of a tenant or of none, and indexed, for the reasons AnalyticsPageViewRecord is
@Entity({ allowOrphan: true, indexes: [['day', 'domain']] })
export class AnalyticsEventRecord extends BaseAnalyticsRecord {
    /**
     * What happened, such as `contact-form-sent`.
     */
    @Property.string()
    name!: string;

    /**
     * The group of the event, such as `contact`.
     */
    @Property.string({ required: false })
    category?: string | null;
}