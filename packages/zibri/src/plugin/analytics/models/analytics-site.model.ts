import { type AnalyticsSiteModel } from 'zibri-contract';

import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitStrict } from '../../../types/omit-strict.type';

/**
 * A site the analytics plugin counts once it is verified: a domain, and the tenant its page views and events belong
 * to, or none for a site of the application itself.
 */
// a tenant's or none, like a role. The unique holds within each tenant and among the sites of none, as on every entity
// whose tenant is optional: several tenants may claim a domain, and that one site of a domain at most is verified is
// checked by the AnalyticsService
@Entity({ allowOrphan: true })
export class AnalyticsSite extends BaseEntity implements OmitStrict<AnalyticsSiteModel, 'verificationRecord'> {
    /**
     * The tenant the site and its counts belong to, or null for a site of no tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;

    /**
     * The host of the site, such as `example.com`, in lower case and without `www.`. Its page views and events are
     * counted once the site is verified, and those of `www.` before it.
     */
    @Property.string({ unique: true })
    domain!: string;

    /**
     * When the site was verified, from when on it is counted. Null for a site of a tenant whose domain was not
     * verified yet, or lost its verification. A site of no tenant is verified when it is created.
     */
    @Property.date({ required: false })
    verifiedAt?: Date | null;

    /**
     * When the daily check of a verified site of a tenant first found its record missing, or null while it finds the
     * record. A site whose record stays missing for `verificationRecordGraceInMs` loses its verification.
     */
    @Property.date({ required: false })
    recordMissingSince?: Date | null;

    /**
     * The random token of the verification record of a site of a tenant, null for a site of no tenant.
     */
    @Property.string({ required: false })
    verificationToken?: string | null;
}

/**
 * What a site is created with: its domain and its tenant. Whether it is verified follows from the tenant.
 */
export type AnalyticsSiteCreateData = Pick<AnalyticsSite, 'domain'> & {
    /**
     * The tenant the site belongs to, or null for none.
     */
    tenantId: string | null
};