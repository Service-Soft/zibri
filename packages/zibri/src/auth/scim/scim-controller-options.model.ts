import { ScimBulkOptions } from './scim-bulk-options.model';
import { type Permission } from '../roles/permission.type';

/**
 * How the SCIM routes of an application are guarded.
 */
export type ScimControllerOptions = {
    /**
     * The permission to provision with, which a role the user of the identity provider's api key holds
     * in the tenant carries, and the key lists. A role carrying it alone keeps that user from doing
     * anything else there.
     */
    permission: Permission,
    /**
     * How much one bulk request may do.
     */
    bulk?: ScimBulkOptions,
    /**
     * How many resources a list answers at most. 200 by default.
     */
    maxResults?: number
};