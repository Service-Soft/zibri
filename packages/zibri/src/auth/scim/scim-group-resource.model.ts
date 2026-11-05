/**
 * A group as an identity provider provisions it through SCIM.
 */
export type ScimGroupResource = {
    /**
     * The id of the SCIM resource.
     */
    id: string,
    /**
     * The name of the group.
     */
    displayName: string,
    /**
     * The id the identity provider gave the group, if it sent one.
     */
    externalId: string | undefined
};