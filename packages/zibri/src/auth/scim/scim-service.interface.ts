import { ScimBody } from './scim-body.model';
import { ScimEndpoint } from './scim-endpoint.model';
import { ScimListQuery } from './scim-list-query.model';
import { ScimResourceResponse } from './scim-resource-response.model';

/**
 * Which attributes a request for one resource asks for.
 */
type ScimResourceQuery = Pick<ScimListQuery, 'attributes' | 'excludedAttributes'>;

/**
 * Interface for the service that answers SCIM requests (RFC 7644): it keeps the resources an identity
 * provider provisions and applies them to the users of the application through a provisioner.
 *
 * Every change that takes an `ifMatch` is applied only while the resource still has a version it
 * names, and is refused with a ScimError (412) otherwise.
 */
export interface ScimServiceInterface {
    /**
     * What the routes support, as a ServiceProviderConfig resource.
     */
    getServiceProviderConfig: (endpoint: ScimEndpoint) => ScimBody,
    /**
     * The resource types the routes keep, as a list of ResourceType resources.
     */
    getResourceTypes: (endpoint: ScimEndpoint) => ScimBody,
    /**
     * One resource type, `User` or `Group`. Throws a ScimError (404) for any other.
     */
    findResourceType: (endpoint: ScimEndpoint, id: string) => ScimBody,
    /**
     * The schemas of the resources the routes keep, as a list of Schema resources.
     */
    getSchemas: (endpoint: ScimEndpoint) => ScimBody,
    /**
     * One schema, by its urn. Throws a ScimError (404) for one the routes do not keep.
     */
    findSchema: (endpoint: ScimEndpoint, id: string) => ScimBody,
    /**
     * Provisions a user.
     */
    createUser: (endpoint: ScimEndpoint, body: unknown) => Promise<ScimResourceResponse>,
    /**
     * Finds a provisioned user. Throws a ScimError (404) when there is none.
     */
    findUser: (endpoint: ScimEndpoint, id: string, query: ScimResourceQuery) => Promise<ScimResourceResponse>,
    /**
     * Finds the provisioned users a query asks for, as a list response.
     */
    findUsers: (endpoint: ScimEndpoint, query: ScimListQuery) => Promise<ScimBody>,
    /**
     * Replaces a provisioned user with the body.
     */
    replaceUser: (endpoint: ScimEndpoint, id: string, body: unknown, ifMatch: string | undefined) => Promise<ScimResourceResponse>,
    /**
     * Applies a patch request to a provisioned user.
     */
    patchUser: (endpoint: ScimEndpoint, id: string, body: unknown, ifMatch: string | undefined) => Promise<ScimResourceResponse>,
    /**
     * Deletes a provisioned user, deactivating the user of the application first.
     */
    deleteUser: (endpoint: ScimEndpoint, id: string, ifMatch: string | undefined) => Promise<void>,
    /**
     * Provisions a group.
     */
    createGroup: (endpoint: ScimEndpoint, body: unknown) => Promise<ScimResourceResponse>,
    /**
     * Finds a provisioned group. Throws a ScimError (404) when there is none.
     */
    findGroup: (endpoint: ScimEndpoint, id: string, query: ScimResourceQuery) => Promise<ScimResourceResponse>,
    /**
     * Finds the provisioned groups a query asks for, as a list response.
     */
    findGroups: (endpoint: ScimEndpoint, query: ScimListQuery) => Promise<ScimBody>,
    /**
     * Replaces a provisioned group with the body.
     */
    replaceGroup: (endpoint: ScimEndpoint, id: string, body: unknown, ifMatch: string | undefined) => Promise<ScimResourceResponse>,
    /**
     * Applies a patch request to a provisioned group.
     */
    patchGroup: (endpoint: ScimEndpoint, id: string, body: unknown, ifMatch: string | undefined) => Promise<ScimResourceResponse>,
    /**
     * Deletes a provisioned group.
     */
    deleteGroup: (endpoint: ScimEndpoint, id: string, ifMatch: string | undefined) => Promise<void>,
    /**
     * Applies the operations of a bulk request one after the other, as a BulkResponse.
     */
    bulk: (endpoint: ScimEndpoint, body: unknown) => Promise<ScimBody>
}