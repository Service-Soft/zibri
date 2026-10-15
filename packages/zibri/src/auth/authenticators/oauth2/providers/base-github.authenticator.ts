import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { InternalError } from '../../../../error-handling/internal-error.model';
import { KnownHeader } from '../../../../http/known-header.enum';
import { MimeType } from '../../../../http/mime-type.enum';
import { JsonUtilities } from '../../../../utilities/json.utilities';
import { BaseUser } from '../../../models/base-user.model';
import { FederatedProfile } from '../../federated/federated-profile.model';
import { FederatedProviderIdentity } from '../../federated/federated-provider-identity.model';
import { OAuthClientAuthentication } from '../../oauth/oauth-client-authentication.model';
import { OAuthProviderTokens } from '../../oauth/oauth-provider-tokens.model';
import { BaseOAuth2Authenticator } from '../base-oauth2.authenticator';

/**
 * What every request to GitHub's api sends: GitHub refuses a request without a user agent, and
 * answers in the version it is asked for.
 */
const GITHUB_HEADERS: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'zibri',
    'x-github-api-version': '2022-11-28'
};

/**
 * What GitHub's api answers about the user an access token belongs to.
 */
type GitHubUser = {
    /**
     * The user's id, which stays the same when they rename their account.
     */
    id: number,
    /**
     * The name the user entered, if any.
     */
    name: string | undefined
};

/**
 * One email of a GitHub account.
 */
type GitHubEmail = {
    /**
     * The address.
     */
    email: string,
    /**
     * Whether it is the account's primary address.
     */
    primary: boolean,
    /**
     * Whether GitHub has verified it.
     */
    verified: boolean
};

/**
 * Authenticates a user by a sign-in with their GitHub account.
 *
 * Extend it with the client id and secret of the OAuth app registered at GitHub. Who signed in is the
 * id of their GitHub account, which stays the same when they rename it, and the email is the primary
 * one of the account.
 */
export abstract class BaseGitHubAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> extends BaseOAuth2Authenticator<RoleType, UserType> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'github';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly issuer: string = 'https://github.com';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly authorizationEndpoint: string = 'https://github.com/login/oauth/authorize';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly tokenEndpoint: string = 'https://github.com/login/oauth/access_token';

    /**
     * Where GitHub's api is reached.
     */
    readonly apiUrl: string = 'https://api.github.com';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly scopes: string[] = ['read:user', 'user:email'];

    // GitHub cannot be told to ask for the password again; letting the user pick the account at least
    // shows them which one they sign in with
    override readonly reauthenticationPrompt: string = 'select_account';

    protected override async resolveIdentity(accessToken: string): Promise<Pick<FederatedProviderIdentity, 'subject' | 'profile'>> {
        const [user, emails] = await Promise.all([
            this.fetchJson(`${this.apiUrl}/user`, accessToken, GITHUB_HEADERS),
            this.fetchJson(`${this.apiUrl}/user/emails`, accessToken, GITHUB_HEADERS)
        ]);
        const account: GitHubUser = this.toUser(user);
        const primary: GitHubEmail | undefined = this.toEmails(emails).find(email => email.primary);
        const profile: FederatedProfile = {
            email: primary?.email,
            emailVerified: primary?.verified,
            name: account.name,
            // GitHub keeps one name, which is not split into given and family name
            givenName: undefined,
            familyName: undefined
        };
        return { subject: String(account.id), profile };
    }

    /**
     * Withdraws what the user allowed the OAuth app, which ends every token issued for it. GitHub takes
     * tokens back through its api rather than at a revocation endpoint.
     * @param tokens - The tokens.
     * @throws When GitHub cannot be reached or refuses.
     */
    protected override async revokeTokens(tokens: Pick<OAuthProviderTokens, 'accessToken' | 'refreshToken'>): Promise<void> {
        const authentication: OAuthClientAuthentication = this.clientAuthentication;
        if (authentication.method === 'private_key_jwt') {
            throw new InternalError(`${this.constructor.name} authenticates with a private key, which GitHub does not take.`);
        }
        const secret: string = typeof authentication.clientSecret === 'string'
            ? authentication.clientSecret
            : await authentication.clientSecret();
        const credentials: string = Buffer.from(`${this.clientId}:${secret}`).toString('base64');
        // through the same client every other request to the provider goes through
        const response: Response = await inject(ZIBRI_DI_TOKENS.HTTP_CLIENT).fetchForLibrary(
            `${this.apiUrl}/applications/${this.clientId}/grant`,
            {
                method: 'DELETE',
                headers: {
                    ...GITHUB_HEADERS,
                    [KnownHeader.AUTHORIZATION]: `Basic ${credentials}`,
                    [KnownHeader.CONTENT_TYPE]: MimeType.JSON
                },
                body: JsonUtilities.stringify({ access_token: tokens.accessToken })
            }
        );
        // 404 when the user withdrew it at GitHub already
        if (!response.ok && response.status !== 404) {
            throw new Error(`GitHub answered ${String(response.status)} to withdrawing the grant of an OAuth app.`);
        }
    }

    private toUser(value: unknown): GitHubUser {
        if (typeof value !== 'object' || value == undefined || !('id' in value) || typeof value.id !== 'number') {
            throw new Error('GitHub answered without the id of the user.');
        }
        return { id: value.id, name: 'name' in value && typeof value.name === 'string' ? value.name : undefined };
    }

    private toEmails(value: unknown): GitHubEmail[] {
        if (!Array.isArray(value)) {
            throw new Error('GitHub answered without the emails of the user.');
        }
        return value.flatMap((entry: unknown): GitHubEmail[] => {
            if (typeof entry !== 'object' || entry == undefined || !('email' in entry) || typeof entry.email !== 'string') {
                return [];
            }
            const email: GitHubEmail = {
                email: entry.email,
                primary: 'primary' in entry && entry.primary === true,
                verified: 'verified' in entry && entry.verified === true
            };
            return [email];
        });
    }
}