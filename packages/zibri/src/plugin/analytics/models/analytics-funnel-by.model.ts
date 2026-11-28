import { type AnalyticsFunnelBy } from 'zibri-contract';

/**
 * What a funnel follows, as `by` of `GET /funnel` takes it and the funnel answers it.
 */
export const ANALYTICS_FUNNEL_BY: Readonly<Record<AnalyticsFunnelBy, AnalyticsFunnelBy>> = { visit: 'visit', visitor: 'visitor' };