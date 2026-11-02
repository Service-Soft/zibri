import assert from 'node:assert';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';

import { OtpCredentials, OtpCredentialsCreateData } from './2fa/methods/otp/otp-credentials.model';
import { OtpTwoFactorMethod } from './2fa/methods/otp/otp.two-factor-method';
import { CreateTwoFactorFailureStreakData, TwoFactorFailureStreak } from './2fa/two-factor-failure-streak.model';
import { PasswordCredentials, PasswordCredentialsCreateData } from './authenticators/password/password-credentials.model';
import { Auth } from './decorators/auth.decorator';
import { AuthStrategyInterface } from './strategies/auth-strategy.interface';
import { CredentialEntity } from './strategies/credential-entity.model';
import { JwtRefreshToken } from './strategies/jwt/jwt-refresh-token.model';
import { JwtAuthStrategy } from './strategies/jwt/jwt.auth-strategy';
import { JwtTestAuthController } from '../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { TestPlatformPermissions } from '../__testing__/mocks/entities/test-permissions.model';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { KnownHeader } from '../http/known-header.enum';
import { OpenApiSecuritySchemeObject } from '../open-api/open-api.model';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { JsonUtilities } from '../utilities/json.utilities';

// over real HTTP against a real login, because all of this is about what a *second* request may do
// with what a first one produced - a second refresh with the same token, a second use of the same
// one time code, a token used after its account changed. Nothing about that shows in a single call

/**
 * The secret the enrolled second factor is registered with.
 *
 * Fixed rather than generated so a failure is reproducible: a flaky TOTP test that cannot be re-run
 * with the same input is not worth having.
 */
// eslint-disable-next-line cspell/spellchecker
const OTP_SECRET: string = 'JBSWY3DPEHPK3PXPJBSWY3DP';

/**
 * How recent a login has to be on the route that names its own window.
 *
 * Two seconds rather than less, because a jwt says when its user logged in to the second: right after
 * a login the time it gives can already be up to a second old.
 */
const REAUTH_WINDOW_IN_MS: number = 2000;

/**
 * Waits until a login made now is older than `REAUTH_WINDOW_IN_MS`.
 */
async function waitPastTheWindow(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, REAUTH_WINDOW_IN_MS + 1000));
}

@Controller('/2fa')
class TwoFactorController {
    @Get('/resource')
    @Auth.require2fa({ allowedMethods: [OtpTwoFactorMethod] })
    resource(): { ok: boolean } {
        return { ok: true };
    }

    @Get('/default-methods')
    @Auth.require2fa()
    defaultMethods(): { ok: boolean } {
        return { ok: true };
    }

    @Get('/reauth')
    @Auth.require2fa({ reauth: true })
    reauth(): { ok: boolean } {
        return { ok: true };
    }

    @Get('/reauth-within-window')
    @Auth.require2fa({ reauth: { allow: true, windowInMs: REAUTH_WINDOW_IN_MS } })
    reauthWithinWindow(): { ok: boolean } {
        return { ok: true };
    }

    @Get('/reauth-as-fallback')
    @Auth.require2fa({ reauth: 'onlyAsFallback' })
    reauthAsFallback(): { ok: boolean } {
        return { ok: true };
    }
}

/**
 * Routes guarded by nothing but a login and what a role carries, so what an access token is still
 * worth can be observed after the account behind it changes.
 */
@Controller('/revocation')
class RevocationController {
    @Get('/me')
    @Auth.isLoggedIn()
    me(): { ok: boolean } {
        return { ok: true };
    }

    @Get('/admin')
    @Auth.hasPlatformPermission(TestPlatformPermissions.ADMIN)
    admin(): { ok: boolean } {
        return { ok: true };
    }
}

/**
 * The header the second strategy below is addressed by.
 */
const API_KEY_HEADER: string = 'x-test-api-key';

/**
 * A second strategy, implementing only what a strategy is actually for.
 *
 * It names a caller and says when it is being addressed, and inherits every authorization check from
 * that, which is what lets a strategy stay this small. A strategy that only reads credentials it did not issue
 * has no login flow, so it implements none.
 *
 * The api key is the user's id, which is not a scheme anybody should copy. It keeps the fixture to
 * the one thing being observed: two credentials in one request.
 */
class ApiKeyAuthStrategy implements AuthStrategyInterface<string, JwtUser> {

    readonly name: string = 'api-key';

    readonly credentialEntities: CredentialEntity[] = [];

    readonly securityScheme: OpenApiSecuritySchemeObject = { type: 'apiKey', in: 'header', name: API_KEY_HEADER };

    hasCredential(context: HttpRequestContext | WebsocketRequestContext): boolean {
        return context.request.headers?.[API_KEY_HEADER as KnownHeader] != undefined;
    }

    async resolveUser(context: HttpRequestContext | WebsocketRequestContext): Promise<JwtUser | undefined> {
        const key: string | undefined = context.request.headers?.[API_KEY_HEADER as KnownHeader];
        return key == undefined ? undefined : await inject(repositoryTokenFor(JwtUser)).findById(key, { required: false });
    }

    // eslint-disable-next-line typescript/require-await
    async resolveAuthenticatedAt(): Promise<undefined> {
        // a key is never logged in with, so there is no time to give
        return undefined;
    }

    // eslint-disable-next-line typescript/require-await
    async resolveExpiresAt(): Promise<undefined> {
        // a user's id does not expire
        return undefined;
    }
}

type TokenResponseBody = {
    userId: string,
    accessToken: { value: string },
    refreshToken: { value: string }
};

let server: StartedTestServer | undefined;
let baseUrl: string;
let userRepository: Repository<JwtUser>;
let credentialsRepository: Repository<PasswordCredentials, PasswordCredentialsCreateData>;
let refreshTokenRepository: Repository<JwtRefreshToken>;
let otpRepository: Repository<OtpCredentials, OtpCredentialsCreateData>;
let streakRepository: Repository<TwoFactorFailureStreak, CreateTwoFactorFailureStreakData>;
let otpHeader: string;
let user: JwtUser;

const email: string = 'rotation-eval@example.com';
const password: string = 'secure123';

/**
 * Logs the fixture user in over http.
 * @returns The access and refresh tokens the framework handed out.
 */
async function login(): Promise<TokenResponseBody> {
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email, password })
    });
    expect(res.status).toBe(200);
    // eslint-disable-next-line typescript/no-unsafe-return
    return await res.json();
}

/**
 * Presents a refresh token to the refresh endpoint.
 * @param refreshToken - The token to present.
 * @returns The raw response, since most assertions here are about the status rather than the body.
 */
async function refreshLogin(refreshToken: string): Promise<Response> {
    return await fetch(`${baseUrl}/auth/refresh-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ refreshToken })
    });
}

/**
 * Calls a route that is guarded by nothing but the login.
 * @param path - The route to call.
 * @param accessToken - The bearer token of the logged in user.
 * @returns The raw response.
 */
async function callAsUser(path: string, accessToken: string): Promise<Response> {
    return await fetch(`${baseUrl}/revocation${path}`, {
        headers: { authorization: `Bearer ${accessToken}` }
    });
}

/**
 * Reads the message a refused request answered with.
 * @param res - The response to read.
 * @returns The whole message, as the error body carries it.
 */
async function messageOf(res: Response): Promise<string> {
    // eslint-disable-next-line typescript/no-unsafe-assignment
    const body: { message: string } = await res.json();
    return body.message;
}

/**
 * Calls the 2fa protected route.
 * @param accessToken - The bearer token of the logged in user.
 * @param code - The one time code to send in the otp header.
 * @param path - The route to call, since one of them takes the default set of methods.
 * @returns The raw response.
 */
async function callProtected(accessToken: string, code: string, path: string = '/resource'): Promise<Response> {
    return await fetch(`${baseUrl}/2fa${path}`, {
        headers: { authorization: `Bearer ${accessToken}`, [otpHeader]: code }
    });
}

/**
 * Calls a 2fa protected route without sending a second factor.
 * @param accessToken - The bearer token of the logged in user.
 * @param path - The route to call.
 * @returns The raw response.
 */
async function callWithoutCode(accessToken: string, path: string): Promise<Response> {
    return await fetch(`${baseUrl}/2fa${path}`, {
        headers: { authorization: `Bearer ${accessToken}` }
    });
}

beforeAll(async () => {
    server = await startTestServer({
        controllers: [JwtTestAuthController, TwoFactorController, RevocationController],
        // two strategies, as docs/auth.md recommends, so that a request carrying both can be refused
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        twoFactorMethods: [OtpTwoFactorMethod]
    });
    baseUrl = await server.start();
    userRepository = inject(repositoryTokenFor(JwtUser));
    credentialsRepository = inject(repositoryTokenFor(PasswordCredentials));
    refreshTokenRepository = inject(repositoryTokenFor(JwtRefreshToken));
    otpRepository = inject(repositoryTokenFor(OtpCredentials));
    streakRepository = inject(repositoryTokenFor(TwoFactorFailureStreak));
    otpHeader = inject(ZIBRI_DI_TOKENS.OTP_HEADER);
}, 60000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 30000);

beforeEach(async () => {
    await refreshTokenRepository.deleteAll({});
    await otpRepository.deleteAll({});
    await streakRepository.deleteAll({});
    await credentialsRepository.deleteAll({});
    await userRepository.deleteAll({});

    user = await userRepository.create({ email, roles: [Roles.USER] });
    await credentialsRepository.create({ password, userId: user.id });
});

describe('JwtAuthStrategy - rotating a refresh token', () => {

    it('rotates the token when it is presented once', async () => {
        // a control: it establishes that rotation works at all, so a failure below is about
        // concurrency rather than about the endpoint being broken
        const { refreshToken }: TokenResponseBody = await login();

        const first: Response = await refreshLogin(refreshToken.value);
        expect(first.status).toBe(200);

        // within the reuse grace a replayed token is a second tab, and gets a token of its own; what
        // rotation guarantees is that the login carries on with a new token, see
        // ./strategies/jwt/jwt.auth-strategy.reuse-grace.test.ts for the grace itself
        const rotated: TokenResponseBody = await first.json() as TokenResponseBody;
        expect(rotated.refreshToken.value).not.toBe(refreshToken.value);
    });

    it('leaves one usable refresh token when the same one is presented twice at once', async () => {
        const { refreshToken }: TokenResponseBody = await login();

        await Promise.all([refreshLogin(refreshToken.value), refreshLogin(refreshToken.value)]);

        // a read and a write that are not one compare and set let both callers read the token as
        // live and both mint into the family. Two live branches is not a state reuse detection has
        // an answer for: whichever one is used later deletes the family the other is still using
        const live: JwtRefreshToken[] = await refreshTokenRepository.findAll({
            where: { userId: user.id, blacklisted: false }
        });

        expect(live).toHaveLength(1);
    });

    it('accepts the same refresh token only once when it is presented twice at once', async () => {
        const { refreshToken }: TokenResponseBody = await login();

        const responses: Response[] = await Promise.all([
            refreshLogin(refreshToken.value),
            refreshLogin(refreshToken.value)
        ]);

        // stated separately from the stored state above because the two fail for different
        // reasons: this one is what the caller sees, and a client that gets two successes has no
        // way to know which of its two tokens the server will still honour
        expect(responses.filter(r => r.status === 200)).toHaveLength(1);
    });
});

describe('AuthService - a refusal does not describe the authorization model', () => {

    it('refuses a caller who lacks the permission a route names without naming it', async () => {
        // the fixture user is a plain USER, whose role carries no ADMIN
        const { accessToken }: TokenResponseBody = await login();

        const res: Response = await callAsUser('/admin', accessToken.value);
        expect(res.status).toBe(403);

        // what opens a route is the authorization model. Handing it to the caller who just proved
        // they lack it means any account at all can walk the routes and map what guards which
        expect(await messageOf(res)).toBe('You do not have permission to access this route.');
    });

    it('answers every refused refresh token with the same message, whatever state it is in', async () => {
        const { refreshToken }: TokenResponseBody = await login();
        expect((await refreshLogin(refreshToken.value)).status).toBe(200);
        // spent: the rotation above blacklisted it. Replayed within the reuse grace it is a second
        // tab of the same login; past the grace, presenting it again destroys the family
        const spent: JwtRefreshToken[] = await refreshTokenRepository.findAll({
            where: { userId: user.id, blacklisted: true }
        });
        await Promise.all(spent.map(async t => await refreshTokenRepository.updateById(t.id, { replacedAt: new Date(0) })));
        const reused: string = await messageOf(await refreshLogin(refreshToken.value));

        const second: TokenResponseBody = await login();
        const live: JwtRefreshToken[] = await refreshTokenRepository.findAll({
            where: { userId: user.id, blacklisted: false }
        });
        await Promise.all(live.map(async t => await refreshTokenRepository.updateById(t.id, { expirationDate: new Date(0) })));
        const expired: string = await messageOf(await refreshLogin(second.refreshToken.value));

        const neverIssued: string = await messageOf(await refreshLogin('not-a-token-this-issuer-signed'));

        // three answers that only matter to a holder who did not issue the token: whether it was
        // ever real, whether it merely aged out, and whether somebody else has already spent it -
        // the last of which says the theft worked. What the framework does about each still
        // differs; the class and the audit trail are where that difference belongs
        expect([reused, expired, neverIssued]).toEqual([
            'Invalid refresh token.',
            'Invalid refresh token.',
            'Invalid refresh token.'
        ]);
    });
});

// a hard limit on wrong codes, with a way back for a locked or lost factor, is in
// ./2fa/two-factor.service.failure-limit.test.ts
describe('TwoFactorService - a second factor is single use', () => {

    it('accepts a confirmed enrollment', async () => {
        // a control for the blocks below: it establishes that a real enrolled factor authenticates,
        // so a failure below means the case it describes rather than 2fa never having worked here
        const credentials: OtpCredentials = await otpRepository.create({
            secret: OTP_SECRET,
            userId: user.id
        });
        await otpRepository.updateById(credentials.id, { confirmed: true });
        const { accessToken }: TokenResponseBody = await login();

        const res: Response = await callProtected(accessToken.value, new TOTP({ secret: OTP_SECRET }).generate());

        expect(res.status).toBe(200);
    });

    it('rejects a code from an enrollment that was never confirmed', async () => {
        // requestRegistration writes the row and confirmRegistration sets confirmed on it: a check
        // that did not read the flag would make an enrollment somebody started and abandoned a
        // working second factor forever, and starting one is not an authenticated action
        await otpRepository.create({ secret: OTP_SECRET, userId: user.id });
        const { accessToken }: TokenResponseBody = await login();

        const res: Response = await callProtected(accessToken.value, new TOTP({ secret: OTP_SECRET }).generate());

        expect(res.status).toBe(401);
    });

    it('refuses a one time code that was already used', async () => {
        const credentials: OtpCredentials = await otpRepository.create({
            secret: OTP_SECRET,
            userId: user.id
        });
        await otpRepository.updateById(credentials.id, { confirmed: true });
        const { accessToken }: TokenResponseBody = await login();
        const code: string = new TOTP({ secret: OTP_SECRET }).generate();

        const first: Response = await callProtected(accessToken.value, code);
        expect(first.status).toBe(200);

        // require2fa checks on every request, so a code nothing marked as spent would travel on
        // every protected call for its whole window and work for anyone who saw it once. "One time"
        // is the only property this factor has
        const replayed: Response = await callProtected(accessToken.value, code);

        expect(replayed.status).toBe(401);
        // told apart from a wrong code, so the user waits for the next one instead of hunting for a
        // typo
        expect(await messageOf(replayed)).toBe('This two factor code has already been used. Wait for your authenticator to show the next one.');
    });

    it('makes the user wait after a wrong code, and refuses even the right one until then', async () => {
        const credentials: OtpCredentials = await otpRepository.create({ secret: OTP_SECRET, userId: user.id });
        await otpRepository.updateById(credentials.id, { confirmed: true });
        const { accessToken }: TokenResponseBody = await login();
        const code: string = new TOTP({ secret: OTP_SECRET }).generate();

        const wrong: Response = await callProtected(accessToken.value, code === '000000' ? '111111' : '000000');
        expect(wrong.status).toBe(401);

        // without a count of wrong codes, a caller holding a session could try the whole code space
        // against the acceptance window. Refused unchecked: checking it would still tell a guesser
        // whether this was the one
        const right: Response = await callProtected(accessToken.value, code);
        expect(right.status).toBe(429);
        expect(right.headers.get('retry-after')).toBe('1');
    });

    it('checks one code per user at a time, so parallel guesses are not each a guess', async () => {
        const credentials: OtpCredentials = await otpRepository.create({ secret: OTP_SECRET, userId: user.id });
        await otpRepository.updateById(credentials.id, { confirmed: true });
        const { accessToken }: TokenResponseBody = await login();
        const code: string = new TOTP({ secret: OTP_SECRET }).generate();
        const wrongCodes: string[] = Array.from({ length: 10 }, (_, i) => `00000${i}`).filter(c => c !== code);

        const responses: Response[] = await Promise.all(wrongCodes.map(async c => await callProtected(accessToken.value, c)));

        // all sent before any answer: a counter read and written around the check lets every one of
        // them read the same streak, which is how parallel sessions undid AuthQuake's limit
        expect(responses.filter(r => r.status === 401)).toHaveLength(1);
        expect(responses.filter(r => r.status === 429)).toHaveLength(wrongCodes.length - 1);
        const [streak]: TwoFactorFailureStreak[] = await streakRepository.findAll({ where: { userId: user.id } });
        expect(streak?.count).toBe(1);
    });

    it('treats an unqualified require2fa as every configured method', async () => {
        const credentials: OtpCredentials = await otpRepository.create({
            secret: OTP_SECRET,
            userId: user.id
        });
        await otpRepository.updateById(credentials.id, { confirmed: true });
        const { accessToken }: TokenResponseBody = await login();

        const res: Response = await callProtected(
            accessToken.value,
            new TOTP({ secret: OTP_SECRET }).generate(),
            '/default-methods'
        );

        // @Auth.require2fa() with no argument stores no methods, which has to mean every configured
        // one: read as none, the route would deny everyone, a user with a valid second factor too
        expect(res.status).toBe(200);
    });
});

describe('AuthService - a sensitive operation asks for a fresh factor', () => {

    it('refuses a logged in session that sends no second factor, and lets the same session through with one', async () => {
        const credentials: OtpCredentials = await otpRepository.create({ secret: OTP_SECRET, userId: user.id });
        await otpRepository.updateById(credentials.id, { confirmed: true });
        const { accessToken }: TokenResponseBody = await login();

        // the control: the session itself is good, so the refusal below is about the missing factor
        expect((await callAsUser('/me', accessToken.value)).status).toBe(200);

        // the factor is asked for by the operation rather than remembered by the session, so a
        // session that logged in once cannot do everything: the login alone does not open it
        const withoutFactor: Response = await callWithoutCode(accessToken.value, '/resource');
        expect(withoutFactor.status).toBe(401);

        const withFactor: Response = await callProtected(accessToken.value, new TOTP({ secret: OTP_SECRET }).generate());
        expect(withFactor.status).toBe(200);
    });
});

describe('AuthService - a fresh login in place of a second factor', () => {

    it('refuses a login in place of a second factor unless the route allows it', async () => {
        // the fixture user has no second factor, which is the user this is for
        const { accessToken }: TokenResponseBody = await login();

        // a second factor only, by default: a login is the factor the session already rests on
        expect((await callWithoutCode(accessToken.value, '/default-methods')).status).toBe(401);
        expect((await callWithoutCode(accessToken.value, '/reauth')).status).toBe(200);
    });

    it('accepts a login inside the window, and refuses one older than it', async () => {
        const { accessToken }: TokenResponseBody = await login();
        expect((await callWithoutCode(accessToken.value, '/reauth-within-window')).status).toBe(200);

        await waitPastTheWindow();

        const late: Response = await callWithoutCode(accessToken.value, '/reauth-within-window');
        expect(late.status).toBe(401);
        // told to log in again, not asked for a code this user does not have
        expect(await messageOf(late)).toBe('Log in again to access this route.');
    }, 15000);

    it('accepts the login as a fallback only from a user without a confirmed second factor the route allows', async () => {
        const { accessToken }: TokenResponseBody = await login();
        expect((await callWithoutCode(accessToken.value, '/reauth-as-fallback')).status).toBe(200);

        // an enrollment nobody finished is no second factor, so the login still stands in for one
        const credentials: OtpCredentials = await otpRepository.create({ secret: OTP_SECRET, userId: user.id });
        expect((await callWithoutCode(accessToken.value, '/reauth-as-fallback')).status).toBe(200);

        // once there is one, it is asked for, however recently the user logged in
        await otpRepository.updateById(credentials.id, { confirmed: true });
        expect((await callWithoutCode(accessToken.value, '/reauth-as-fallback')).status).toBe(401);
        const withFactor: Response = await callProtected(
            accessToken.value,
            new TOTP({ secret: OTP_SECRET }).generate(),
            '/reauth-as-fallback'
        );
        expect(withFactor.status).toBe(200);
    });

    it('keeps the time of the login across a refresh', async () => {
        const { refreshToken }: TokenResponseBody = await login();
        await waitPastTheWindow();

        const refreshed: Response = await refreshLogin(refreshToken.value);
        expect(refreshed.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { accessToken }: TokenResponseBody = await refreshed.json();

        // a new access token, but not a new login: holding a refresh token must not be enough to
        // present yourself as having just logged in
        expect((await callWithoutCode(accessToken.value, '/reauth-within-window')).status).toBe(401);
    }, 15000);

    it('refuses a caller whose strategy cannot say when it logged in', async () => {
        // a key is never logged in with, so there is no login for a route to accept
        const res: Response = await fetch(`${baseUrl}/2fa/reauth`, {
            headers: { [API_KEY_HEADER]: user.id }
        });

        expect(res.status).toBe(401);
    });

    it('has no long form for refusing a login', () => {
        // the long form exists to carry a window, which means nothing for a route that takes no login
        // @ts-expect-error false is only the shorthand
        expect(Auth.require2fa({ reauth: { allow: false } })).toBeDefined();
    });
});

describe('AuthService - a token stops being worth what it says', () => {

    it('stops honouring a role that was revoked after the token was issued', async () => {
        await userRepository.updateById(user.id, { roles: [Roles.USER, Roles.ADMIN] });
        const { accessToken }: TokenResponseBody = await login();

        // the control: the token really does open this route, so the denial below is about the role
        // being taken away rather than about the route or the token
        expect((await callAsUser('/admin', accessToken.value)).status).toBe(200);

        await userRepository.updateById(user.id, { roles: [Roles.USER] });

        // the same token, still perfectly valid and still saying ADMIN in its payload. An offboarding
        // that only takes effect when a token happens to expire is not an offboarding.
        //
        // 403 rather than 401 is the second half of that: the token is fine and refreshing it would
        // hand back the same answer forever, which is exactly what a client does when told 401.
        expect((await callAsUser('/admin', accessToken.value)).status).toBe(403);
    });

    it('lets a second strategy inherit every check from resolveUser alone', async () => {
        await userRepository.updateById(user.id, { roles: [Roles.USER, Roles.ADMIN] });

        // ApiKeyAuthStrategy implements a name, a security scheme, hasCredential and resolveUser.
        // It never says what having a role means, and it does not have to.
        const res: Response = await fetch(`${baseUrl}/revocation/admin`, {
            headers: { [API_KEY_HEADER]: user.id }
        });

        expect(res.status).toBe(200);
    });

    it('refuses a request that carries two credentials at once', async () => {
        await userRepository.updateById(user.id, { roles: [Roles.USER, Roles.ADMIN] });
        const { accessToken }: TokenResponseBody = await login();
        const other: JwtUser = await userRepository.create({ email: 'other-eval@example.com', roles: [Roles.USER] });

        // an admin's key next to a plain user's token. Whichever of the two the framework picked, the
        // route would run as one identity having been let in by the other.
        const res: Response = await fetch(`${baseUrl}/revocation/admin`, {
            headers: { authorization: `Bearer ${accessToken.value}`, [API_KEY_HEADER]: other.id }
        });

        expect(res.status).toBe(401);
    });

    it('stops honouring a token whose account has been deleted', async () => {
        const { accessToken }: TokenResponseBody = await login();
        expect((await callAsUser('/me', accessToken.value)).status).toBe(200);

        await credentialsRepository.deleteAll({ userId: user.id });
        await userRepository.deleteById(user.id);

        expect((await callAsUser('/me', accessToken.value)).status).toBe(401);
    });

    it('keeps honouring a token whose account is untouched', async () => {
        const { accessToken }: TokenResponseBody = await login();

        // reading the account on every check must not turn into denying the ones that are fine
        expect((await callAsUser('/me', accessToken.value)).status).toBe(200);
        expect((await callAsUser('/me', accessToken.value)).status).toBe(200);
    });
});

// last in the file on purpose: it replaces the running application with one configured differently,
// and nothing after it would be looking at the server the tests above started
describe('AuthService - the application\'s default for a fresh login', () => {

    it('accepts a login on a route that says nothing, once the application allows it', async () => {
        assert(server);
        await server.reInit({
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH, useValue: true })
            ]
        });
        baseUrl = await server.start();

        const { accessToken }: TokenResponseBody = await login();

        expect((await callWithoutCode(accessToken.value, '/default-methods')).status).toBe(200);
    }, 30000);
});