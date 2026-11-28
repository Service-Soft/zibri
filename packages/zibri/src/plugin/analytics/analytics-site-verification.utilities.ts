import { AnalyticsSiteDetails } from './models/analytics-site-details.model';
import { AnalyticsSiteVerificationRecord } from './models/analytics-site-verification-record.model';
import { AnalyticsSite } from './models/analytics-site.model';

/**
 * The DNS record that verifies a site of the analytics, and a site as the site routes answer it.
 */
// neutral, with no name of the framework in it: the record sits in the zone of the domain of a customer
export abstract class AnalyticsSiteVerificationUtilities {
    /**
     * What the value of a verification record starts with, followed by the token of the site.
     */
    static readonly RECORD_PREFIX: string = 'analytics-site-verification=';

    /**
     * The value of the TXT record that verifies a site with a token.
     * @param token - The verification token of the site.
     * @returns The value, such as `analytics-site-verification=<token>`.
     */
    static getRecordValue(token: string): string {
        return `${AnalyticsSiteVerificationUtilities.RECORD_PREFIX}${token}`;
    }

    /**
     * A site as the site routes answer it, with the record that verifies it.
     * @param site - The site.
     * @returns The site and its record.
     */
    static getDetails(site: AnalyticsSite): AnalyticsSiteDetails {
        const token: string | null | undefined = site.verificationToken;
        // answered once verified too: the record stays on the domain for as long as the site is counted
        const verificationRecord: AnalyticsSiteVerificationRecord | null = token == undefined
            ? null
            : { type: 'TXT', name: site.domain, value: AnalyticsSiteVerificationUtilities.getRecordValue(token) };
        return {
            id: site.id,
            domain: site.domain,
            tenantId: site.tenantId ?? null,
            verifiedAt: site.verifiedAt ?? null,
            recordMissingSince: site.recordMissingSince ?? null,
            verificationToken: site.verificationToken ?? null,
            verificationRecord
        };
    }
}