import { type AnalyticsSiteVerificationRecordModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The types a verification record has: TXT alone.
 */
const RECORD_TYPES: Readonly<Record<'TXT', 'TXT'>> = { TXT: 'TXT' };

/**
 * The DNS record that verifies a site: a TXT record on the domain of the site itself.
 */
export class AnalyticsSiteVerificationRecord implements AnalyticsSiteVerificationRecordModel {
    /**
     * The type of the record, always `TXT`.
     */
    @Property.string({ enum: RECORD_TYPES })
    type!: 'TXT';

    /**
     * The name the record is added under: the domain of the site, such as `example.com`.
     */
    @Property.string()
    name!: string;

    /**
     * The value of the record, `analytics-site-verification=` followed by the token of the site.
     */
    @Property.string()
    value!: string;
}