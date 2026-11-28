import { type AnalyticsPageModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The page views of one page in one language, as `GET /pages` of the `AnalyticsController` answers them.
 */
export class AnalyticsPage implements AnalyticsPageModel {
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
     * Every page view of the page.
     */
    @Property.number({ format: 'integer' })
    pageViews!: number;

    /**
     * The visits that entered on the page.
     */
    @Property.number({ format: 'integer' })
    entries!: number;

    /**
     * The page views that carried a visitor id, which a visitor sends only with consent. `visitors` and
     * `firstVisits` are counted among these alone.
     */
    @Property.number({ format: 'integer' })
    consentedPageViews!: number;

    /**
     * The visitors who consented and viewed the page, each counted once.
     */
    @Property.number({ format: 'integer' })
    visitors!: number;

    /**
     * The visitors who consented and whose first page view kept is of the page.
     */
    @Property.number({ format: 'integer' })
    firstVisits!: number;
}