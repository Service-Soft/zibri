import { BaseUser } from '../../../models/base-user.model';
import { OAuthOfflineAccess } from '../../oauth/oauth-offline-access.model';
import { BaseOidcAuthenticator } from '../base-oidc.authenticator';
import { OidcAuthenticationTime } from '../oidc-authentication-time.type';

/**
 * Authenticates a user by a login with their account in a Microsoft Entra ID tenant.
 *
 * Extend it with the tenant id, the client id and credentials of the app registered in it, and whether
 * that registration adds `auth_time` to the optional claims of its ID tokens.
 */
export abstract class BaseMicrosoftAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> extends BaseOidcAuthenticator<RoleType, UserType> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'microsoft';

    /**
     * The id of the tenant whose accounts log in.
     */
    abstract readonly tenantId: string;

    /**
     * `auth_time` when the app registration adds `auth_time` to the optional claims of its ID tokens,
     * `none` otherwise: Entra ID sends it only when asked to in the registration.
     */
    abstract override readonly authenticationTime: OidcAuthenticationTime;

    // Microsoft issues a refresh token for the offline_access scope without asking for consent again
    override readonly offlineAccess: OAuthOfflineAccess = { scopes: ['offline_access'], prompts: [], parameters: {} };

    // Entra's `sub` is pairwise: another value for every app registration, and yet another in an
    // access token issued for an api. The object id is the one key the same person has in all of them
    override readonly subjectClaim: string = 'oid';

    // eslint-disable-next-line jsdoc/require-jsdoc
    get issuer(): string {
        return `https://login.microsoftonline.com/${this.tenantId}/v2.0`;
    }
}