/**
 * What an event about the membership of a user in a tenant carries, such as one emitted when it ends.
 */
export type MembershipEventData = {
    /**
     * The id of the user.
     */
    userId: string,
    /**
     * The id of the tenant.
     */
    tenantId: string
};
