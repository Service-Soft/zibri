/**
 * A membership of the logged in user in a tenant, as `GET /me` answers it.
 */
export type CurrentUserMembership<Permission extends string = string> = {
    /**
     * The id of the tenant.
     */
    tenantId: string,
    /**
     * What the user may do in the tenant.
     */
    permissions: Permission[]
};