/**
 * A user as an identity provider provisions it through SCIM.
 */
export type ScimUserResource = {
    /**
     * The id of the SCIM resource.
     */
    id: string,
    /**
     * The name the identity provider knows the user by, often the email address.
     */
    userName: string,
    /**
     * The id the identity provider gave the user, if it sent one.
     */
    externalId: string | undefined,
    /**
     * Whether the identity provider has the user active. An inactive user is deactivated.
     */
    active: boolean,
    /**
     * Every other attribute the identity provider sent, eg. `name`, `displayName`, `emails` or the
     * enterprise extension under `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`.
     */
    attributes: Record<string, unknown>
};