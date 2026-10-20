import { BaseUser } from '../../../models/base-user.model.ts';
import { OAuthOfflineAccess } from '../../oauth/oauth-offline-access.model.ts';
import { BaseOidcAuthenticator } from '../base-oidc.authenticator.ts';

/**
 * Authenticates a user by a sign-in with their account in a Microsoft Entra ID tenant.
 *
 * Extend it with the tenant id, and the client id and credentials of the app registered in it.
 */
export abstract class BaseMicrosoftAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> extends BaseOidcAuthenticator<RoleType, UserType> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly name: string = 'microsoft';

    /**
     * The id of the tenant whose accounts sign in.
     */
    abstract readonly tenantId: string;

    // Microsoft issues a refresh token for the offline_access scope without asking for consent again
    override readonly offlineAccess: OAuthOfflineAccess = { scopes: ['offline_access'], prompts: [], parameters: {} };

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    get issuer(): string {
        return `https://login.microsoftonline.com/${this.tenantId}/v2.0`;
    }
}