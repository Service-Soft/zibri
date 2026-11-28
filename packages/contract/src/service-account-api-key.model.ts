/**
 * An API key of a service account, as the routes of the service accounts answer it. The key itself is never part of it.
 */
export type ServiceAccountApiKeyModel = {
    /**
     * The id of the key, which is the `client_id` of the key at the token endpoint.
     */
    id: string,
    /**
     * What the key is for, such as the assistant or the script that sends it.
     */
    name: string,
    /**
     * The permissions the key may use, of either level. A request with it holds those of them the roles of the service
     * account carry.
     */
    permissions: string[],
    /**
     * The tenant the key is bound to. Undefined for a key that acts in every tenant the service account is a member of.
     */
    tenantId?: string,
    /**
     * When the key stops working, as an ISO string. Undefined for a key that works until it is revoked.
     */
    expiresAt?: string,
    /**
     * When the key was last used, as an ISO string. Undefined for a key never used.
     */
    lastUsedAt?: string,
    /**
     * When the key was created, as an ISO string.
     */
    createdAt: string,
    /**
     * Whether the key is only exchanged for tokens bound to a DPoP key, and never taken in the API key header.
     */
    requireDpop: boolean
};