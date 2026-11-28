import { type AnalyticsFunnelBy, type AnalyticsFunnelModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { ANALYTICS_FUNNEL_BY } from './analytics-funnel-by.model';
import { AnalyticsFunnelSource } from './analytics-funnel-source.model';
import { AnalyticsFunnelStep } from './analytics-funnel-step.model';

/**
 * How many visits, or visitors, reached each of the given steps in order, as `GET /funnel` of the
 * `AnalyticsController` answers it.
 */
export class AnalyticsFunnel implements AnalyticsFunnelModel {
    /**
     * What was followed. `'visitor'` covers only the visitors who consented, across their visits.
     */
    @Property.string({ enum: ANALYTICS_FUNNEL_BY })
    by!: AnalyticsFunnelBy;

    /**
     * The steps, in the order they were asked for.
     */
    @Property.array({ items: { type: 'object', cls: () => AnalyticsFunnelStep } })
    steps!: AnalyticsFunnelStep[];

    /**
     * The visits or visitors that entered in the range.
     */
    @Property.number({ format: 'integer' })
    entered!: number;

    /**
     * How many of them reached each step after the steps before it, by step.
     */
    @Property.array({ items: { type: 'number', format: 'integer' } })
    reached!: number[];

    /**
     * The same by source, the most entered first.
     */
    @Property.array({ items: { type: 'object', cls: () => AnalyticsFunnelSource } })
    sources!: AnalyticsFunnelSource[];
}