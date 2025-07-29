import { Property } from '../entity';
import { MetricType } from './metric-type.enum';

/**
 * A single recorded measurement.
 */
export class Metric {
    /**
     * Metric name (e.g. 'http_requests_total').
     */
    @Property.string()
    name!: string;
    /**
     * Metric type.
     */
    @Property.string({ enum: MetricType })
    type!: MetricType;
    /**
     * One sample value (cumulative for counter, gauge value, histogram bucket/summary).
     */
    @Property.number()
    value!: number;
    /**
     * The combination of labels that this sample applies to.
     */
    @Property.unknown()
    labels!: Record<string, string | number | undefined>;
}