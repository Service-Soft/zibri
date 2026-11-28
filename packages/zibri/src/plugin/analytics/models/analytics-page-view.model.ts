import { type AnalyticsPageViewModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { AnalyticsLimits } from './analytics-limits.model';
import { AnalyticsSource } from './analytics-source.model';

/**
 * A page view, as `POST /page-views` of the `AnalyticsController` takes it.
 */
export class AnalyticsPageView implements AnalyticsPageViewModel {
    /**
     * A random uuid per visit, which links the page views and events of one visit.
     */
    @Property.string({ format: 'uuid' })
    visitId!: string;

    /**
     * The host of the site, such as `example.com`. Counted only when an `AnalyticsSite` has it, with or without `www.`.
     */
    @Property.string({ maxLength: AnalyticsLimits.HOST_MAX_LENGTH, regex: AnalyticsLimits.HOST_REGEX })
    domain!: string;

    /**
     * The path of the page, without query and hash, such as `/takeover`.
     */
    @Property.string({ maxLength: AnalyticsLimits.PATH_MAX_LENGTH, regex: AnalyticsLimits.PATH_REGEX })
    path!: string;

    /**
     * The locale of the page, such as `de`.
     */
    @Property.string({ maxLength: AnalyticsLimits.LANGUAGE_MAX_LENGTH, regex: AnalyticsLimits.LANGUAGE_REGEX })
    language!: string;

    /**
     * Whether this is the first page view of the visit.
     */
    @Property.boolean()
    entry!: boolean;

    /**
     * Where the visit came from.
     */
    @Property.object({ cls: () => AnalyticsSource })
    source!: AnalyticsSource;

    /**
     * A random uuid per device, sent only with the consent of the visitor.
     */
    @Property.string({ format: 'uuid', required: false })
    visitorId?: string;
}