import { ScimProvisionerClass } from './scim-provisioner-class.type.ts';

/**
 * The SCIM routes of one controller: where they answer, and what they provision with.
 */
export type ScimEndpoint = {
    /**
     * The provisioner the routes provision with.
     */
    provisioner: ScimProvisionerClass,
    /**
     * The url of the routes, eg. `https://api.example.com/scim/v2`, which the location of every
     * resource starts with.
     */
    url: string,
    /**
     * The most operations a bulk request may hold.
     */
    maxBulkOperations: number,
    /**
     * The most bytes a bulk request may weigh.
     */
    maxBulkPayloadSize: number
};