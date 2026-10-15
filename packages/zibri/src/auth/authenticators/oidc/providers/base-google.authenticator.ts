import { BaseUser } from '../../../models/base-user.model';
import { OAuthOfflineAccess } from '../../oauth/oauth-offline-access.model';
import { BaseOidcAuthenticator } from '../base-oidc.authenticator';

/**
 * Authenticates a user by a sign-in with their Google account.
 *
 * Extend it with the client id and secret of the OAuth client created in the Google Cloud console.
 */
export abstract class BaseGoogleAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> extends BaseOidcAuthenticator<RoleType, UserType> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'google';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly issuer: string = 'https://accounts.google.com';

    // Google refuses `prompt=login` with an error page, and has no prompt that asks for the password
    // again; letting the user pick the account at least shows them which one they sign in with
    override readonly reauthenticationPrompt: string = 'select_account';

    // Google's own way rather than the offline_access scope, which it does not know. It issues a refresh
    // token only when the user is asked for consent, and the scopes granted before are added to the
    // new ones rather than replaced by them
    override readonly offlineAccess: OAuthOfflineAccess = {
        scopes: [],
        prompts: ['consent'],
        parameters: { access_type: 'offline', include_granted_scopes: 'true' }
    };
}