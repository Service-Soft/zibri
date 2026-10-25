import { ApiKeyClientAuthentication } from './api-key-client-authentication.model';
import { type Permission } from '../../roles/permission.type';
import { type PlatformPermission } from '../../roles/platform-permission.type';

/**
 * What a new api key is created with.
 */
export type ApiKeyCreateData<
    ClientAuthentication extends ApiKeyClientAuthentication | undefined = ApiKeyClientAuthentication | undefined
> = {
    /**
     * What the key is for, such as the service or script that sends it.
     */
    name: string,
    /**
     * The permissions the key may use, of either level. Each one has to be carried by a role of the
     * user, of their own or through a membership - in the tenant the key is bound to, when it is bound
     * to one.
     */
    permissions: (Permission | PlatformPermission)[],
    /**
     * The tenant the key is bound to, or undefined for a key that acts in every tenant its user is a
     * member of.
     */
    tenantId: string | undefined,
    /**
     * When the key stops working, or undefined for a key that works until it is revoked.
     */
    expiresAt: Date | undefined,
    /**
     * How the key proves itself at the token endpoint of the authorization server, or undefined for a
     * key that is a secret, sent in the api key header or as the client secret.
     */
    clientAuthentication: ClientAuthentication,
    /**
     * Whether every token the key is exchanged for is bound to a DPoP key. A key that is a secret and
     * requires it is never sent in the api key header, only exchanged for a token.
     */
    requireDpop: boolean
};