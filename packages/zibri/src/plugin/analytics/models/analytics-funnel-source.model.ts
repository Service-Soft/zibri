import { type AnalyticsFunnelSourceModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { AnalyticsSource } from './analytics-source.model';

/**
 * A funnel of the visits or visitors of one source.
 */
export class AnalyticsFunnelSource implements AnalyticsFunnelSourceModel {
    /**
     * The source of the visit, or of the first visit of the visitor in the range.
     */
    @Property.object({ cls: () => AnalyticsSource })
    source!: AnalyticsSource;

    /**
     * The visits or visitors of the source that entered in the range.
     */
    @Property.number({ format: 'integer' })
    entered!: number;

    /**
     * How many of them reached each step after the steps before it, by step.
     */
    @Property.array({ items: { type: 'number', format: 'integer' } })
    reached!: number[];
}