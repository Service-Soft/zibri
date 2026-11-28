/**
 * An API key to create for a service account, as `POST /:serviceAccountId/api-keys` of the routes of the service
 * accounts takes it.
 */
export type NewServiceAccountApiKeyModel = {
    /**
     * What the key is for, such as the assistant or the script that sends it.
     */
    name: string,
    /**
     * The permissions the key may use, of either level. Each one needs to be carried by a role of the service account,
     * of its own or through its membership in the tenant the key is bound to.
     */
    permissions: string[],
    /**
     * The tenant the key is bound to, one the service account is a member of. Undefined for a key that acts in every
     * tenant it is a member of.
     */
    tenantId?: string,
    /**
     * When the key stops working, as an ISO string in the future. Undefined for a key that works until it is revoked.
     */
    expiresAt?: string,
    /**
     * Whether the key is only exchanged for tokens bound to a DPoP key, and never taken in the API key header. False
     * for a key an MCP client sends in the header.
     */
    requireDpop: boolean
};
