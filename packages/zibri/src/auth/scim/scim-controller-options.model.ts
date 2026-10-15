import { ScimBulkOptions } from './scim-bulk-options.model';

/**
 * How the SCIM routes of an application are guarded.
 */
export type ScimControllerOptions<RoleType extends string> = {
    /**
     * The roles that may provision, one of which the user of the identity provider's api key holds in
     * the tenant. A role of its own for provisioning keeps that user from doing anything else there.
     */
    roles: RoleType[],
    /**
     * How much one bulk request may do.
     */
    bulk?: ScimBulkOptions
};