/**
 * What names a role: its name, and the tenant whose own role it is, since two tenants can each have
 * a role of one name.
 */
export type RoleIdentity = {
    /**
     * The name of the role.
     */
    name: string,
    /**
     * The tenant whose own role it is, null for a role every tenant shares.
     */
    tenantId: string | null
};