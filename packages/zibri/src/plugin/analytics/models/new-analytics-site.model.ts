import { type NewAnalyticsSiteModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { AnalyticsLimits } from './analytics-limits.model';

/**
 * A site to count, as `POST /sites` of the `AnalyticsController` takes it.
 */
export class NewAnalyticsSite implements NewAnalyticsSiteModel {
    /**
     * The host of the site, such as `example.com`. Stored in lower case and without `www.`.
     */
    @Property.string({ maxLength: AnalyticsLimits.HOST_MAX_LENGTH, regex: AnalyticsLimits.HOST_REGEX })
    domain!: string;

    /**
     * The tenant the site belongs to, or null for a site of no tenant. Only a caller holding
     * `analytics.sites.manage_all` names one other than the tenant of the request. Without it, the site belongs to
     * the tenant of the request, or to none when the request names none.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;
}