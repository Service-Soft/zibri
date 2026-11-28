import { type Timezone } from '../../../localization/models/timezone.model';
import { type RetentionInMs } from '../../../types/retention-in-ms.type';

/**
 * Configuration for the analytics plugin.
 */
export type AnalyticsPluginOptions = {
    /**
     * The time zone whose calendar days the page views and events are counted by.
     */
    readonly timezone: Timezone,
    /**
     * How long a page view or event is kept, counted from its day.
     * @default Ms.YEAR * 2
     */
    readonly retentionInMs: RetentionInMs,
    /**
     * How long the daily check of a verified site of a tenant may find its record missing before the site loses its
     * verification.
     * @default Ms.DAY * 7
     */
    readonly verificationRecordGraceInMs: number
};