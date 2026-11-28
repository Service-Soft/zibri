import { type AnalyticsEventModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { AnalyticsLimits } from './analytics-limits.model';
import { AnalyticsSource } from './analytics-source.model';

/**
 * Something a visitor did, such as sending the contact form, as `POST /events` of the `AnalyticsController` takes it.
 */
export class AnalyticsEvent implements AnalyticsEventModel {
    /**
     * The random uuid of the visit, as its page views send it.
     */
    @Property.string({ format: 'uuid' })
    visitId!: string;

    /**
     * The host of the site, such as `example.com`. Counted only when an `AnalyticsSite` has it, with or without `www.`.
     */
    @Property.string({ maxLength: AnalyticsLimits.HOST_MAX_LENGTH, regex: AnalyticsLimits.HOST_REGEX })
    domain!: string;

    /**
     * What happened, such as `contact-form-sent`.
     */
    @Property.string({ minLength: 1, maxLength: AnalyticsLimits.EVENT_NAME_MAX_LENGTH })
    name!: string;

    /**
     * The group of the event, such as `contact`.
     */
    @Property.string({ required: false, minLength: 1, maxLength: AnalyticsLimits.EVENT_NAME_MAX_LENGTH })
    category?: string;

    /**
     * The path of the page it happened on, without query and hash.
     */
    @Property.string({ maxLength: AnalyticsLimits.PATH_MAX_LENGTH, regex: AnalyticsLimits.PATH_REGEX })
    path!: string;

    /**
     * The locale of the page, such as `de`.
     */
    @Property.string({ maxLength: AnalyticsLimits.LANGUAGE_MAX_LENGTH, regex: AnalyticsLimits.LANGUAGE_REGEX })
    language!: string;

    /**
     * Where the visit came from.
     */
    @Property.object({ cls: () => AnalyticsSource })
    source!: AnalyticsSource;

    /**
     * The random uuid of the device, sent only with the consent of the visitor.
     */
    @Property.string({ format: 'uuid', required: false })
    visitorId?: string;
}