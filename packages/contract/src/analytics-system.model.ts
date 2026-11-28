import { type AnalyticsOperatingSystem } from './analytics-operating-system.enum';

/**
 * The page views of one operating system, as `GET /analytics/systems` answers them.
 */
export type AnalyticsSystemModel = {
    /**
     * The operating system.
     */
    operatingSystem: AnalyticsOperatingSystem,
    /**
     * The page views that came from it.
     */
    pageViews: number
};