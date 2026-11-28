import { type AnalyticsSourceModel } from './analytics-source.model';

/**
 * Something a visitor did, such as sending the contact form, as `POST /analytics/events` takes it.
 */
export type AnalyticsEventModel = {
    /**
     * The random uuid of the visit, as its page views send it.
     */
    visitId: string,
    /**
     * The host of the site, such as `example.com`. Counted only when the api allows it.
     */
    domain: string,
    /**
     * What happened, such as `contact-form-sent`.
     */
    name: string,
    /**
     * The group of the event, such as `contact`.
     */
    category?: string,
    /**
     * The path of the page it happened on, without query and hash.
     */
    path: string,
    /**
     * The locale of the page, such as `de`.
     */
    language: string,
    /**
     * Where the visit came from.
     */
    source: AnalyticsSourceModel,
    /**
     * The random uuid of the device, sent only with the consent of the visitor.
     */
    visitorId?: string
};