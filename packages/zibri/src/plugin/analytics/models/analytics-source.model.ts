import { type AnalyticsSourceModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { AnalyticsLimits } from './analytics-limits.model';

/**
 * Where a visit came from: the host of the external page that linked to its entry, and the `utm_*` parameters of the
 * url it entered with.
 */
export class AnalyticsSource implements AnalyticsSourceModel {
    /**
     * The host of the external referrer, such as `google.com`, without `www.`.
     */
    @Property.string({
        required: false,
        minLength: 1,
        maxLength: AnalyticsLimits.HOST_MAX_LENGTH,
        regex: AnalyticsLimits.HOST_REGEX
    })
    referrer?: string;

    /**
     * The `utm_source` parameter of the entry.
     */
    @Property.string({ required: false, minLength: 1, maxLength: AnalyticsLimits.UTM_MAX_LENGTH })
    utmSource?: string;

    /**
     * The `utm_medium` parameter of the entry.
     */
    @Property.string({ required: false, minLength: 1, maxLength: AnalyticsLimits.UTM_MAX_LENGTH })
    utmMedium?: string;

    /**
     * The `utm_campaign` parameter of the entry.
     */
    @Property.string({ required: false, minLength: 1, maxLength: AnalyticsLimits.UTM_MAX_LENGTH })
    utmCampaign?: string;

    /**
     * The `utm_term` parameter of the entry.
     */
    @Property.string({ required: false, minLength: 1, maxLength: AnalyticsLimits.UTM_MAX_LENGTH })
    utmTerm?: string;

    /**
     * The `utm_content` parameter of the entry.
     */
    @Property.string({ required: false, minLength: 1, maxLength: AnalyticsLimits.UTM_MAX_LENGTH })
    utmContent?: string;
}