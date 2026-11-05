/**
 * What an event about changed roles carries: where the roles that changed are held.
 */
export type RolesChangedEventData = {
    /**
     * The tenant whose own roles changed, or null for the roles every tenant shares.
     */
    tenantId: string | null
};