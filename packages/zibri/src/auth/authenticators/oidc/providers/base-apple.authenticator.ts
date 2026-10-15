import { createPrivateKey, KeyObject, sign } from 'node:crypto';

import type { IDToken } from 'openid-client';

import { JsonUtilities } from '../../../../utilities/json.utilities';
import { BaseUser } from '../../../models/base-user.model';
import { FederatedProfile } from '../../federated/federated-profile.model';
import { OAuthClientAuthentication } from '../../oauth/oauth-client-authentication.model';
import { OAuthResponseMode } from '../../oauth/oauth-response-mode.type';
import { BaseOidcAuthenticator } from '../base-oidc.authenticator';

/**
 * The name Apple posts next to the code, on the first sign-in only.
 */
type ApplePostedName = {
    /**
     * The first name, as the user entered it.
     */
    firstName: string | undefined,
    /**
     * The last name, as the user entered it.
     */
    lastName: string | undefined
};

/**
 * How long a client secret signed for one exchange stays valid.
 */
const CLIENT_SECRET_LIFETIME_IN_SECONDS: number = 300;

/**
 * Authenticates a user by a sign-in with their Apple account.
 *
 * Extend it with the services id as the client id, the team id, and the id and private key of the key
 * created for Sign in with Apple. Apple answers with a form post, and sends the user's name next to the
 * code on their first sign-in only.
 */
export abstract class BaseAppleAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> extends BaseOidcAuthenticator<RoleType, UserType> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'apple';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly issuer: string = 'https://appleid.apple.com';

    override readonly scopes: string[] = ['openid', 'email', 'name'];

    override readonly responseMode: OAuthResponseMode = 'form_post';

    /**
     * The id of the Apple developer team the services id belongs to.
     */
    abstract readonly teamId: string;

    /**
     * The id of the key created for Sign in with Apple.
     */
    abstract readonly keyId: string;

    /**
     * That key, as the contents of the `.p8` file Apple hands it out as.
     */
    abstract readonly privateKey: string;

    // read once, when the first client secret is signed
    private signingKey: KeyObject | undefined;

    // Apple's client secret is a JWT the application signs itself, so it is signed for every exchange
    // eslint-disable-next-line jsdoc/require-jsdoc
    get clientAuthentication(): OAuthClientAuthentication {
        return { method: 'client_secret_post', clientSecret: () => Promise.resolve(this.resolveClientSecret()) };
    }

    protected override resolveProfile(
        claims: IDToken,
        answer: URLSearchParams
    ): FederatedProfile {
        const posted: ApplePostedName | undefined = this.findPostedName(answer.get('user'));
        const givenName: string | undefined = posted?.firstName;
        const familyName: string | undefined = posted?.lastName;
        const name: string = [givenName, familyName].filter(part => part != undefined).join(' ');
        return {
            ...super.resolveProfile(claims, answer),
            // Apple has sent whether the email is verified as the text "true" as well as a boolean
            emailVerified: this.findFlag(claims['email_verified']),
            givenName,
            familyName,
            name: name || undefined
        };
    }

    /**
     * Signs the client secret Apple takes: a JWT from the team, about the services id, for Apple.
     * @returns The client secret.
     */
    private resolveClientSecret(): string {
        const now: number = Math.floor(Date.now() / 1000);
        const encode: (value: object) => string = value => Buffer.from(JsonUtilities.stringify(value)).toString('base64url');
        const input: string = `${encode({ alg: 'ES256', kid: this.keyId })}.${encode({
            iss: this.teamId,
            iat: now,
            exp: now + CLIENT_SECRET_LIFETIME_IN_SECONDS,
            aud: this.issuer,
            sub: this.clientId
        })}`;
        this.signingKey ??= createPrivateKey(this.privateKey);
        // r and s side by side, which is how a JWT carries an ECDSA signature
        const signature: Buffer = sign('sha256', Buffer.from(input), { key: this.signingKey, dsaEncoding: 'ieee-p1363' });
        return `${input}.${signature.toString('base64url')}`;
    }

    private findPostedName(user: string | null): ApplePostedName | undefined {
        if (user == undefined) {
            return undefined;
        }
        let parsed: unknown;
        try {
            parsed = JsonUtilities.parse<unknown>(user);
        }
        catch {
            return undefined;
        }
        if (typeof parsed !== 'object' || parsed == undefined || !('name' in parsed)) {
            return undefined;
        }
        const name: unknown = parsed.name;
        if (typeof name !== 'object' || name == undefined) {
            return undefined;
        }
        return {
            firstName: 'firstName' in name && typeof name.firstName === 'string' ? name.firstName : undefined,
            lastName: 'lastName' in name && typeof name.lastName === 'string' ? name.lastName : undefined
        };
    }

    private findFlag(value: unknown): boolean | undefined {
        if (value === true || value === 'true') {
            return true;
        }
        if (value === false || value === 'false') {
            return false;
        }
        return undefined;
    }
}