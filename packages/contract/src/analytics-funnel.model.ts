import { type AnalyticsFunnelBy } from './analytics-funnel-by.type';
import { type AnalyticsFunnelSourceModel } from './analytics-funnel-source.model';
import { type AnalyticsFunnelStepModel } from './analytics-funnel-step.model';

/**
 * How many visits, or visitors, reached each of the given steps in order, as `GET /analytics/funnel` answers it.
 */
export type AnalyticsFunnelModel = {
    /**
     * What was followed. `'visitor'` covers only the visitors who consented, across their visits.
     */
    by: AnalyticsFunnelBy,
    /**
     * The steps, in the order they were asked for.
     */
    steps: AnalyticsFunnelStepModel[],
    /**
     * The visits or visitors that entered in the range.
     */
    entered: number,
    /**
     * How many of them reached each step after the steps before it, by step.
     */
    reached: number[],
    /**
     * The same by source, the most entered first.
     */
    sources: AnalyticsFunnelSourceModel[]
};