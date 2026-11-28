import { BaseEntity } from '../../../entity/base-entity.model';
import { Property } from '../../../entity/decorators/property.decorator';
import { AnalyticsOperatingSystem } from './analytics-operating-system.enum';

/**
 * What every stored page view and event holds: the tenant of its site, when it arrived, the site, the page, the visit,
 * the visitor when they consented, the source of the visit and the operating system. No address and no `User-Agent`.
 */
export class BaseAnalyticsRecord extends BaseEntity {
    /**
     * The tenant of its site, or null for a site of no tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;

    /**
     * The day it arrived on, in the `timezone` of the plugin, as midnight UTC of that day.
     */
    @Property.date()
    day!: Date;

    /**
     * When it arrived, which orders the steps of a visit.
     */
    @Property.date()
    receivedAt!: Date;

    /**
     * The host of the site.
     */
    @Property.string()
    domain!: string;

    /**
     * The path of the page.
     */
    @Property.string()
    path!: string;

    /**
     * The locale of the page.
     */
    @Property.string()
    language!: string;

    /**
     * The random uuid of the visit.
     */
    @Property.string({ format: 'uuid' })
    visitId!: string;

    /**
     * The random uuid of the device, when the visitor consented.
     */
    @Property.string({ format: 'uuid', required: false, index: true })
    visitorId?: string | null;

    /**
     * The host of the external referrer of the visit.
     */
    @Property.string({ required: false })
    referrer?: string | null;

    /**
     * The `utm_source` parameter of the visit.
     */
    @Property.string({ required: false })
    utmSource?: string | null;

    /**
     * The `utm_medium` parameter of the visit.
     */
    @Property.string({ required: false })
    utmMedium?: string | null;

    /**
     * The `utm_campaign` parameter of the visit.
     */
    @Property.string({ required: false })
    utmCampaign?: string | null;

    /**
     * The `utm_term` parameter of the visit.
     */
    @Property.string({ required: false })
    utmTerm?: string | null;

    /**
     * The `utm_content` parameter of the visit.
     */
    @Property.string({ required: false })
    utmContent?: string | null;

    /**
     * The rough operating system, read from the `User-Agent`.
     */
    @Property.string({ enum: AnalyticsOperatingSystem })
    operatingSystem!: AnalyticsOperatingSystem;
}