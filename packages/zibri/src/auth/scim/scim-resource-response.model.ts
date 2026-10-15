import { ScimBody } from './scim-body.model';

/**
 * A SCIM resource as a route answers with it: its body, and what its headers say.
 */
export type ScimResourceResponse = {
    /**
     * The id of the resource.
     */
    id: string,
    /**
     * The resource, narrowed to the attributes the request asked for.
     */
    body: ScimBody,
    /**
     * Its version, as an etag, eg. `W/"3"`.
     */
    version: string,
    /**
     * Its url.
     */
    location: string
};