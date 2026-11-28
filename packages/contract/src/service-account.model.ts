import { type ServiceAccountApiKeyModel } from './service-account-api-key.model';

/**
 * A service account, as the routes of the service accounts answer it: a user that acts through its API keys only, such
 * as an AI assistant calling the MCP server, with its roles and its keys.
 */
export type ServiceAccountModel = {
    /**
     * The id of the user.
     */
    id: string,
    /**
     * What the service account is for, such as `assistant`: lowercase letters, digits and hyphens between them.
     */
    name: string,
    /**
     * The platform roles of the service account.
     */
    roles: string[],
    /**
     * The tenant roles of its membership in the tenant the request acts in. Empty when it is no member there, or the
     * request acts in no tenant.
     */
    tenantRoles: string[],
    /**
     * Its API keys, expired ones included, oldest first.
     */
    apiKeys: ServiceAccountApiKeyModel[]
};