/**
 * The roles a service account holds from now on, as `PUT /:serviceAccountId/roles` of the routes of the service
 * accounts takes them. The caller needs to be allowed to hand out each role it gains and take each one it loses, as
 * for assigning and unassigning it.
 */
export type ServiceAccountRolesModel = {
    /**
     * Its platform roles.
     */
    roles: string[],
    /**
     * Its tenant roles in the tenant the request acts in, which needs to be empty for a request that acts in no tenant.
     */
    tenantRoles: string[]
};
