/**
 * What a request listing SCIM resources asks for (RFC 7644, 3.4.2).
 */
export type ScimListQuery = {
    /**
     * Which resources, eg. `userName eq "anna@example.com"`. Every one when undefined.
     */
    filter: string | undefined,
    /**
     * The attribute to sort by, eg. `userName`. The order they were provisioned in when undefined.
     */
    sortBy: string | undefined,
    /**
     * `ascending` or `descending`. Ascending when undefined.
     */
    sortOrder: string | undefined,
    /**
     * The position of the first resource to answer with, counting from 1.
     */
    startIndex: number | undefined,
    /**
     * How many resources to answer with at most.
     */
    count: number | undefined,
    /**
     * The attributes to answer with, separated by commas. Every one when undefined.
     */
    attributes: string | undefined,
    /**
     * The attributes to leave out, separated by commas, eg. `members`.
     */
    excludedAttributes: string | undefined
};