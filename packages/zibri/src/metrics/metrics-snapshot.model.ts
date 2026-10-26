import { Metric } from './metric.model';
import { Property } from '../entity/decorators/property.decorator';

/**
 * A collected snapshot of all metrics.
 */
export class MetricsSnapshot {
    /**
     * The time at which the snapshot was taken.
     */
    @Property.date()
    timestamp!: Date;

    /**
     * All metrics at the timestamp.
     */
    @Property.array({ items: { type: 'object', cls: () => Metric } })
    metrics!: Metric[];
}
