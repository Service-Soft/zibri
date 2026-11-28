import { type AnalyticsSiteVerificationRecordModel } from './analytics-site-verification-record.model';

/**
 * A site the analytics count, as `GET /analytics/sites`, `POST /analytics/sites` and
 * `POST /analytics/sites/:id/verify` answer it.
 */
export type AnalyticsSiteModel = {
    /**
     * The id of the site.
     */
    id: string,
    /**
     * The host of the site, such as `example.com`, in lower case and without `www.`. Its page views and events are
     * counted once the site is verified, and those of `www.` before it.
     */
    domain: string,
    /**
     * The tenant the site and its counts belong to, or null for a site of the application itself.
     */
    tenantId?: string | null,
    /**
     * When the site was verified, from when on it is counted. Null for a site of a tenant whose domain was not
     * verified yet, or lost its verification. A site of no tenant is verified when it is created.
     */
    verifiedAt?: Date | null,
    /**
     * When the daily check of a verified site of a tenant first found its record missing, or null while it finds the
     * record. A site whose record stays missing for a week, by default, loses its verification.
     */
    recordMissingSince?: Date | null,
    /**
     * The random token of the verification record of a site of a tenant, null for a site of no tenant.
     */
    verificationToken?: string | null,
    /**
     * The DNS record that verifies a site of a tenant: added to verify it, and kept on the domain for as long as the
     * site is counted. Null for a site of no tenant.
     */
    verificationRecord?: AnalyticsSiteVerificationRecordModel | null
};