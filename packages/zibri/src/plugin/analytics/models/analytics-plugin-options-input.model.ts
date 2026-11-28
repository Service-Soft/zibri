import { OmitStrict } from '../../../types/omit-strict.type';
import { AnalyticsPluginOptions } from './analytics-plugin-options.model';

/**
 * Input for configuring the analytics plugin: the time zone, the retention unless two years, and how long a record
 * may be missing unless a week.
 */
export type AnalyticsPluginOptionsInput = OmitStrict<AnalyticsPluginOptions, 'retentionInMs' | 'verificationRecordGraceInMs'>
    & Partial<Pick<AnalyticsPluginOptions, 'retentionInMs' | 'verificationRecordGraceInMs'>>;