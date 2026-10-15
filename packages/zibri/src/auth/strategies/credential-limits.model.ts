/**
 * What the credential of a request may do, beyond being its user: an api key that may use some of the
 * user's roles, in one of their tenants.
 */
export type CredentialLimits = {
    /**
     * The roles the credential may use. A request made with it holds those of them the user holds.
     */
    roles: string[],
    /**
     * The tenant the credential is bound to. A request made with it for any other tenant is refused.
     * Undefined for a credential that acts in every tenant the user is a member of.
     */
    tenantId: string | undefined
};