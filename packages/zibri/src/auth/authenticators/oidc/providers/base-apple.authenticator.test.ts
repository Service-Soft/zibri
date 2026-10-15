import { generateKeyPairSync, KeyObject, KeyPairKeyObjectResult, verify } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, FakeOAuthProvider, InMemoryDataSource, startFakeOAuthProvider, TestBrowser } from 'zibri-testing';

import { BaseAppleAuthenticator } from './base-apple.authenticator';
import { JwtUser } from '../../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities } from '../../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { defineProvider } from '../../../../di/models/di-provider.model';
import { KnownHeader } from '../../../../http/known-header.enum';
import { MimeType } from '../../../../http/mime-type.enum';
import { Body } from '../../../../routing/decorators/body.decorator';
import { Controller } from '../../../../routing/decorators/controller.decorator';
import { Post } from '../../../../routing/decorators/post.decorator';
import { Newable } from '../../../../types/newable.type';
import { JsonUtilities } from '../../../../utilities/json.utilities';
import { OtpTwoFactorMethod } from '../../../2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../../auth-controller/auth-controller.model';
import { Auth } from '../../../decorators/auth.decorator';
import { CookieAuthRefreshSession } from '../../../strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../../../strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../../../strategies/cookie/cookie-auth.auth-strategy';
import { FederatedConnectionCode } from '../../federated/federated-connection-code.model';
import { FederatedTicketCredentials } from '../../federated/federated-credentials.model';
import { FederatedHandoverCode } from '../../federated/federated-handover-code.model';
import { FederatedIdentity, FederatedIdentityCreateData } from '../../federated/federated-identity.model';
import { FederatedLoginAttempt } from '../../federated/federated-login-attempt.model';
import { FederatedRegistrationTicket } from '../../federated/federated-registration-ticket.model';
import { FederatedRegistration } from '../../federated/federated-registration.model';

const PUBLIC_URL: string = 'http://zibri.test';
const SERVICES_ID: string = 'com.example.app.sign-in';
const TEAM_ID: string = 'TEAM123456';
const KEY_ID: string = 'KEY1234567';
const REDIRECT_TO: string = 'https://app.example.com/signed-in';
const REGISTRATION_URL: string = 'https://app.example.com/register';

let apple: FakeOAuthProvider;
// generated before the provider starts, which checks every client secret against the public half. In
// the shape Apple hands a key out in, a `.p8` file
const keyPair: KeyPairKeyObjectResult = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const p8: string = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
// the client secrets the provider was sent, and whether each was signed for it
const clientSecrets: boolean[] = [];

class AppleAuthenticator extends BaseAppleAuthenticator<Roles, JwtUser> {
    readonly clientId: string = SERVICES_ID;

    readonly teamId: string = TEAM_ID;

    readonly keyId: string = KEY_ID;

    readonly privateKey: string = p8;

    // Apple itself, played by the fake provider, which is running by the time the application builds this
    override readonly issuer: string = apple.issuer;
}

@Auth.skip({ allowRedundant: true })
@Controller('/auth', { versions: 'all' })
class AppleAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [AppleAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

@Controller('/register', { allowOrphan: true })
class ProfileController {
    // what a registration reads before it creates the user
    @Post('/profile')
    async profile(
        @Body(FederatedTicketCredentials)
        credentials: FederatedTicketCredentials
    ): Promise<FederatedRegistration> {
        return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).resolveRegistration(AppleAuthenticator, credentials, undefined);
    }
}

/**
 * Checks a client secret the way Apple does: a JWT signed with the key, from the team, about the
 * services id, for Apple, and not expired.
 * @param secret - The client secret.
 * @param publicKey - The public half of the key.
 * @returns Whether Apple takes it.
 */
function isSignedForApple(secret: string, publicKey: KeyObject): boolean {
    const [header = '', payload = '', signature = ''] = secret.split('.');
    const decode: (part: string) => Record<string, unknown> = part => JsonUtilities.parse<Record<string, unknown>>(Buffer.from(part, 'base64url').toString('utf8'));
    const head: Record<string, unknown> = decode(header);
    const claims: Record<string, unknown> = decode(payload);
    const signed: boolean = verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
    return signed
        && head['alg'] === 'ES256'
        && head['kid'] === KEY_ID
        && claims['iss'] === TEAM_ID
        && claims['sub'] === SERVICES_ID
        && claims['aud'] === apple.issuer
        && typeof claims['exp'] === 'number' && claims['exp'] > Date.now() / 1000;
}

describe('BaseAppleAuthenticator', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        apple = await startFakeOAuthProvider({
            clientId: SERVICES_ID,
            clientSecret: secret => {
                const valid: boolean = isSignedForApple(secret, keyPair.publicKey);
                clientSecrets.push(valid);
                return valid;
            },
            formPost: true
        });
        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
            entities: [
                ...defaultTestServerEntities,
                CookieAuthSession,
                CookieAuthRefreshSession,
                FederatedLoginAttempt,
                FederatedIdentity,
                FederatedHandoverCode,
                FederatedRegistrationTicket,
                FederatedConnectionCode
            ],
            allowOrphan: true
        });
        server = await startTestServer({
            baseUrl: PUBLIC_URL,
            dataSources: [dataSourceClass],
            authStrategies: [CookieAuthStrategy],
            authenticators: [AppleAuthenticator],
            controllers: [AppleAuthController, ProfileController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS,
                    useValue: {
                        allowedRedirects: ['https://app.example.com'],
                        registrationUrl: REGISTRATION_URL,
                        errorUrl: 'https://app.example.com/sign-in-failed',
                        maxAuthenticationAgeInMs: 3600000
                    }
                })
            ]
        });
        baseUrl = await server.start();
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
        await apple?.stop();
    }, 15000);

    /**
     * Signs in at Apple the way a browser does, up to the answer Apple posts to the callback.
     * @param browser - The browser.
     * @returns The response of the callback.
     */
    async function signIn(browser: TestBrowser): Promise<Response> {
        const atApple: string = await browser.follow(`${PUBLIC_URL}/auth/federated/authorize?${new URLSearchParams({ redirectTo: REDIRECT_TO }).toString()}`);
        await browser.open(atApple);
        return await browser.open(`${PUBLIC_URL}/auth/federated/apple/callback`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.FORM_URL_ENCODED },
            body: apple.formPosts.at(-1),
            crossSiteFrom: new URL(apple.issuer).origin
        });
    }

    it('asks Apple for a form post, with the name and the email', async () => {
        const atApple: URL = new URL(await new TestBrowser(baseUrl, PUBLIC_URL).follow(
            `${PUBLIC_URL}/auth/federated/authorize?${new URLSearchParams({ redirectTo: REDIRECT_TO }).toString()}`
        ));

        expect(atApple.searchParams.get('response_mode')).toBe('form_post');
        expect(atApple.searchParams.get('scope')).toBe('openid email name');
    });

    it('signs a linked user in, with a client secret signed for Apple', async () => {
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: 'grace@example.com', roles: [Roles.USER] });
        await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(repositoryTokenFor(FederatedIdentity))
            .create({ issuer: apple.issuer, subject: 'apple-grace', userId: user.id, signIn: true, grantedScopes: [] });
        apple.identity = { subject: 'apple-grace' };
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);
        const secretsBefore: number = clientSecrets.length;

        const res: Response = await signIn(browser);

        expect(res.headers.get(KnownHeader.LOCATION)).toBe(REDIRECT_TO);
        expect(clientSecrets.slice(secretsBefore)).toStrictEqual([true]);
        expect((await browser.open(`${baseUrl}/auth/csrf-token`)).status).toBe(200);
    });

    it('signs a fresh client secret for every exchange', async () => {
        apple.identity = { subject: 'apple-grace' };
        const secretsBefore: number = clientSecrets.length;

        await signIn(new TestBrowser(baseUrl, PUBLIC_URL));
        await signIn(new TestBrowser(baseUrl, PUBLIC_URL));

        expect(clientSecrets.slice(secretsBefore)).toStrictEqual([true, true]);
    });

    it('reads the name Apple posts on the first sign-in, and the email it says is verified as text', async () => {
        apple.identity = { subject: 'apple-ada', email: 'ada@privaterelay.appleid.com' };
        apple.addToNextAnswer({ user: JsonUtilities.stringify({ name: { firstName: 'Ada', lastName: 'Lovelace' }, email: 'ada@privaterelay.appleid.com' }) });
        apple.rewriteNextIdToken(claims => ({ ...claims, email_verified: 'true' }));
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const landing: string = (await signIn(browser)).headers.get(KnownHeader.LOCATION) ?? '';
        expect(landing.startsWith(`${REGISTRATION_URL}?ticket=`)).toBe(true);
        const res: Response = await browser.open(`${baseUrl}/register/profile`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
            body: JsonUtilities.stringify({ ticket: new URL(landing).searchParams.get('ticket') })
        });

        expect(await res.json()).toMatchObject({
            email: 'ada@privaterelay.appleid.com',
            emailVerified: true,
            givenName: 'Ada',
            familyName: 'Lovelace',
            name: 'Ada Lovelace'
        });
    });

    it('leaves the name out when what Apple posted cannot be read', async () => {
        apple.identity = { subject: 'apple-unreadable' };
        apple.addToNextAnswer({ user: '{not json' });
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const landing: string = (await signIn(browser)).headers.get(KnownHeader.LOCATION) ?? '';
        const res: Response = await browser.open(`${baseUrl}/register/profile`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
            body: JsonUtilities.stringify({ ticket: new URL(landing).searchParams.get('ticket') })
        });

        expect(res.status).toBe(200);
        expect(await res.json()).not.toHaveProperty('givenName');
    });
});