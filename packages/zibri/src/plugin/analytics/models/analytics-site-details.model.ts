import { type AnalyticsSiteModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { AnalyticsSiteVerificationRecord } from './analytics-site-verification-record.model';

/**
 * A site, as the site routes of the `AnalyticsController` answer it: the `AnalyticsSite`, and the DNS record that
 * verifies it while it is not verified.
 */
export class AnalyticsSiteDetails implements AnalyticsSiteModel {
    /**
     * The id of the site.
     */
    @Property.string({ format: 'uuid' })
    id!: string;

    /**
     * The host of the site, such as `example.com`, in lower case and without `www.`.
     */
    @Property.string()
    domain!: string;

    /**
     * The tenant the site and its counts belong to, or null for a site of no tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;

    /**
     * When the site was verified, from when on it is counted, or null while it is not.
     */
    @Property.date({ required: false })
    verifiedAt?: Date | null;

    /**
     * When the daily check of the verified site first found its record missing, or null while it finds the record.
     */
    @Property.date({ required: false })
    recordMissingSince?: Date | null;

    /**
     * The random token of the verification record of a site of a tenant, null for a site of no tenant.
     */
    @Property.string({ required: false })
    verificationToken?: string | null;

    /**
     * The DNS record that verifies a site of a tenant: added to verify it, and kept on the domain for as long as the
     * site is counted. Null for a site of no tenant.
     */
    @Property.object({ cls: () => AnalyticsSiteVerificationRecord, required: false })
    verificationRecord?: AnalyticsSiteVerificationRecord | null;
}