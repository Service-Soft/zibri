import { type AnalyticsSourceModel } from './analytics-source.model';

/**
 * A funnel of the visits or visitors of one source.
 */
export type AnalyticsFunnelSourceModel = {
    /**
     * The source of the visit, or of the first visit of the visitor in the range.
     */
    source: AnalyticsSourceModel,
    /**
     * The visits or visitors of the source that entered in the range.
     */
    entered: number,
    /**
     * How many of them reached each step after the steps before it, by step.
     */
    reached: number[]
};