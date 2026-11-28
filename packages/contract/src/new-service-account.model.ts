/**
 * A service account to create, as `POST /` of the routes of the service accounts takes it. The caller needs to be
 * allowed to hand out each role, as for assigning it.
 */
export type NewServiceAccountModel = {
    /**
     * What the service account is for, such as `assistant`: lowercase letters, digits and hyphens between them, unique.
     */
    name: string,
    /**
     * The platform roles it gets.
     */
    roles: string[],
    /**
     * The tenant roles it gets through a membership in the tenant the request acts in. Empty for no membership, and
     * needs to be empty for a request that acts in no tenant.
     */
    tenantRoles: string[]
};
