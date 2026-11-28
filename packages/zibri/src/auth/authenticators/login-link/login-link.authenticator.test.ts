import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';
import { createInMemoryDataSource, RecordingEmailTransport } from 'zibri-testing';

import { compileTsxTemplate } from '../../../__testing__/compile-tsx-template.function';
import { TestTimeouts } from '../../../__testing__/constants';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../../__testing__/wait-until.function';
import { AuditEntry } from '../../../audit/audit-entry.model';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider, DiProvider } from '../../../di/models/di-provider.model';
import { EmailConfigInput } from '../../../email/models/email-config.model';
import { KnownHeader } from '../../../http/known-header.enum';
import { MimeType } from '../../../http/mime-type.enum';
import { LeaseOptions } from '../../../leases/lease-options.model';
import { LeaseService } from '../../../leases/lease.service';
import { AuditAction, AuditOutcome, AuditReason } from '../../../logging/audit-event.model';
import { RateLimitStoreFailurePolicy } from '../../../rate-limiting/limiter/rate-limiter-config.model';
import { RateLimitStateEntity } from '../../../rate-limiting/stores/rate-limit-state-entity.model';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { Ms } from '../../../utilities/ms';
import { EmailTwoFactorMethod } from '../../2fa/methods/code/email.two-factor-method';
import { TwoFactorCodeCredentials, TwoFactorCodeCredentialsCreateData } from '../../2fa/methods/code/two-factor-code-credentials.model';
import { TwoFactorCode } from '../../2fa/methods/code/two-factor-code.model';
import { OtpCredentials, OtpCredentialsCreateData } from '../../2fa/methods/otp/otp-credentials.model';
import { OtpTwoFactorMethod } from '../../2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../auth-controller/auth-controller.model';
import { AuthRateLimitOptions } from '../../auth.rate-limiter';
import { Auth } from '../../decorators/auth.decorator';
import { CookieAuthRefreshSession } from '../../strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../../strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../../strategies/cookie/cookie-auth.auth-strategy';
import { JwtAuthStrategy } from '../../strategies/jwt/jwt.auth-strategy';
import { type UserServiceInterface } from '../../user/user-service.interface';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../password/password-credentials.model';
import { PasswordAuthenticator } from '../password/password.authenticator';
import { LoginLinkEmailTemplate } from './login-link-email-template.model';
import { LoginLinkOptions } from './login-link-options.model';
import { LoginLinkToken, LoginLinkTokenCreateData } from './login-link-token.model';
import { LoginLinkAuthenticator } from './login-link.authenticator';

const PASSWORD: string = 'correct horse battery staple';
const LOGIN_LINK_URL: string = 'https://app.example.com/login-link';
// fixed rather than generated, so that a failing case can be re-run with the same input
// eslint-disable-next-line cspell/spellchecker
const OTP_SECRET: string = 'JBSWY3DPEHPK3PXPJBSWY3DP';
const BINDING_COOKIE: string = 'zibri-login-link';

/**
 * What the login route answers when a second factor is still to come.
 */
type PendingLoginBody = {
    name: string,
    ticket: string,
    methods: string[]
};

/**
 * What a jwt login answers.
 */
type TokenBody = {
    accessToken: { value: string },
    refreshToken: { value: string }
};

/**
 * What a refusal answers.
 */
type ErrorBody = {
    name: string,
    message: string
};

/**
 * The auth routes of an application logging in with a password or a link, as released.
 */
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class LoginLinkTestAuthController extends AuthController({
        strategies: [JwtAuthStrategy, CookieAuthStrategy],
        authenticators: [PasswordAuthenticator, LoginLinkAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod, EmailTwoFactorMethod]
    }) {}

/**
 * The same routes, with the one answering the ways of logging in.
 */
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class LoginMethodsTestAuthController extends AuthController({
        strategies: [JwtAuthStrategy, CookieAuthStrategy],
        authenticators: [PasswordAuthenticator, LoginLinkAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod, EmailTwoFactorMethod],
        loginMethodsRoute: true
    }) {}

/**
 * A route that takes a second factor or a recent login.
 */
@Controller('/profile', { allowOrphan: true })
class ProfileTestController {
    @Auth.require2fa({ reauth: true })
    @Get('/address')
    address(): { ok: boolean } {
        return { ok: true };
    }

    @Auth.require2fa({ reauth: { allow: true, windowInMs: 1 } })
    @Get('/iban')
    iban(): { ok: boolean } {
        return { ok: true };
    }
}

let releaseLinks: () => void = () => undefined;
let linksReleased: Promise<void> = Promise.resolve();

/**
 * Holds every link at its lease until the test lets it go.
 */
class HeldLinkLeaseService extends LeaseService {
    override async withLease<T>(options: LeaseOptions, fn: (lost: AbortSignal) => Promise<T>): Promise<T | undefined> {
        if (options.key.startsWith('login-link:')) {
            await linksReleased;
        }
        return await super.withLease(options, fn);
    }
}

/**
 * Holds the next links until `releaseLinks` is called.
 */
function holdLinks(): void {
    linksReleased = new Promise<void>(resolve => {
        releaseLinks = resolve;
    });
}

const transport: RecordingEmailTransport = new RecordingEmailTransport();

const loginLinkOptions: LoginLinkOptions = {
    loginLinkUrl: LOGIN_LINK_URL,
    loginLinkEmail: compileTsxTemplate<LoginLinkEmailTemplate>('export const Email = ({ loginLink }) => <a href={loginLink}></a>;')
};

/**
 * The providers of the suite.
 * @param options - What differs from the options of the links.
 * @param maxAttempts - How many attempts `AuthRateLimiter` allows a caller and an email.
 * @returns The providers.
 */
function providersWith(options: Partial<LoginLinkOptions> = {}, maxAttempts: number = 1000): DiProvider<unknown>[] {
    return [
        ...defaultTestServerProviders,
        defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
        defineProvider({ token: ZIBRI_DI_TOKENS.LOGIN_LINK_OPTIONS, useValue: { ...loginLinkOptions, ...options } }),
        defineProvider({
            token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
            useFactory: (): EmailConfigInput => ({ maxEmailsPerHour: 1000, defaultSender: 'Ada', failedRetentionInMs: 'forever' })
        }),
        defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport }),
        defineProvider({ token: ZIBRI_DI_TOKENS.LEASE_SERVICE, useClass: HeldLinkLeaseService }),
        defineProvider({
            token: ZIBRI_DI_TOKENS.AUTH_RATE_LIMIT_OPTIONS,
            useFactory: (): AuthRateLimitOptions => ({ maxAttempts, windowInMs: Ms.MINUTE * 10, onStoreFailure: RateLimitStoreFailurePolicy.ALLOW })
        }),
        // short, so that a case about a wrong code does not wait
        defineProvider({ token: ZIBRI_DI_TOKENS.TWO_FACTOR_FAILURE_DELAY_IN_MS, useFactory: () => 1 })
    ];
}

let server: StartedTestServer;
let baseUrl: string;

/**
 * Creates a user with a password and an email nobody verified.
 * @param name - What sets the user's email apart.
 * @returns The user.
 */
async function createUser(name: string): Promise<JwtUser> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: `${name}@login-link.test`, roles: [Roles.USER] });
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ userId: user.id, password: PASSWORD });
    return user;
}

/**
 * Creates a service account through the user service.
 * @param name - The name of the service account.
 * @returns The service account.
 */
async function createServiceAccount(name: string): Promise<JwtUser> {
    const userService: UserServiceInterface = inject(ZIBRI_DI_TOKENS.USER_SERVICE);
    if (userService.createServiceAccount == undefined) {
        throw new Error('The user service of the test server creates service accounts.');
    }
    return await userService.createServiceAccount(JwtUser, { name, roles: [Roles.USER] }, undefined);
}

/**
 * Creates a user without a password, such as an invitation without one does.
 * @param name - What sets the user's email apart.
 * @returns The user.
 */
async function createUserWithoutPassword(name: string): Promise<JwtUser> {
    return await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: `${name}@login-link.test`, roles: [Roles.USER] });
}

async function enrollOtp(user: JwtUser): Promise<void> {
    const repository: Repository<OtpCredentials, OtpCredentialsCreateData> = inject(repositoryTokenFor(OtpCredentials));
    const credentials: OtpCredentials = await repository.create({ secret: OTP_SECRET, userId: user.id });
    await repository.updateById(credentials.id, { confirmed: true });
}

async function enrollEmail(user: JwtUser): Promise<void> {
    const repository: Repository<TwoFactorCodeCredentials, TwoFactorCodeCredentialsCreateData> = inject(repositoryTokenFor(TwoFactorCodeCredentials));
    const credentials: TwoFactorCodeCredentials = await repository.create({ userId: user.id, channel: 'email', destination: undefined });
    await repository.updateById(credentials.id, { confirmed: true });
}

async function requestLink(email: string): Promise<Response> {
    return await fetch(`${baseUrl}/auth/request-login-link`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify({ email })
    });
}

function sendsTo(email: string): number {
    return transport.sends.filter(sent => sent.recipients.includes(email)).length;
}

/**
 * Asks for a link for a user, and reads its token off the mail once it is sent.
 * @param user - The user.
 * @returns The response of the request, and the token.
 */
async function mailedLinkOf(user: JwtUser): Promise<{ res: Response, token: string }> {
    const before: number = sendsTo(user.email);
    const res: Response = await requestLink(user.email);
    expect(res.status).toBe(204);
    await waitUntil(async () => {
        await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
        return sendsTo(user.email) > before;
    });
    const html: string = transport.sends.filter(sent => sent.recipients.includes(user.email)).at(-1)?.html ?? '';
    const link: string = /href="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(link.startsWith(`${LOGIN_LINK_URL}/`)).toBe(true);
    return { res, token: link.split('/').at(-1) ?? '' };
}

async function logInWithLink(token: string, strategy: string = 'jwt', headers: Record<string, string> = {}): Promise<Response> {
    return await fetch(`${baseUrl}/auth/login?authenticator=login-link&strategy=${strategy}`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON, ...headers },
        body: JsonUtilities.stringify({ token })
    });
}

async function logInWithPassword(user: JwtUser, strategy: string = 'jwt'): Promise<Response> {
    return await fetch(`${baseUrl}/auth/login?authenticator=password&strategy=${strategy}`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify({ email: user.email, password: PASSWORD })
    });
}

async function continueWith(path: string, ticket: string, headers: Record<string, string> = {}): Promise<Response> {
    return await fetch(`${baseUrl}/auth/login/2fa${path}`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON, [inject(ZIBRI_DI_TOKENS.LOGIN_TICKET_HEADER)]: ticket, ...headers }
    });
}

async function readAddress(headers: Record<string, string>): Promise<Response> {
    return await fetch(`${baseUrl}/profile/address`, { headers });
}

function cookiesOf(res: Response): string {
    return res.headers.getSetCookie().map(line => line.split(';')[0])
        .join('; ');
}

async function entriesOf(action: AuditAction, subject: string): Promise<AuditEntry[]> {
    await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
    return await inject(repositoryTokenFor(AuditEntry)).findAll({ where: { action, subject }, acrossTenants: true });
}

async function entriesOfUser(action: AuditAction, userId: string): Promise<AuditEntry[]> {
    await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
    return await inject(repositoryTokenFor(AuditEntry)).findAll({ where: { action, userId }, acrossTenants: true });
}

async function tokensOf(user: JwtUser): Promise<LoginLinkToken[]> {
    return await inject<Repository<LoginLinkToken, LoginLinkTokenCreateData>>(repositoryTokenFor(LoginLinkToken)).findAll({ where: { userId: user.id } });
}

/**
 * Builds the application of the suite again, with other options.
 * @param options - What differs from the options of the links.
 * @param twoFactorAtLogin - Whether a login asks for a second factor.
 * @param maxAttempts - How many attempts `AuthRateLimiter` allows.
 */
async function restartWith(
    options: Partial<LoginLinkOptions>,
    twoFactorAtLogin: 'ifEnrolled' | 'required' = 'ifEnrolled',
    maxAttempts: number = 1000
): Promise<void> {
    await server.reInit({ providers: providersWith(options, maxAttempts), twoFactorAtLogin });
    baseUrl = await server.start();
}

describe('LoginLinkAuthenticator', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [
                createInMemoryDataSource({
                    entities: [
                        ...defaultTestServerEntities,
                        LoginLinkToken,
                        TwoFactorCodeCredentials,
                        TwoFactorCode,
                        RateLimitStateEntity,
                        CookieAuthSession,
                        CookieAuthRefreshSession
                    ],
                    repositories: defaultTestServerRepositories
                })
            ],
            authStrategies: [JwtAuthStrategy, CookieAuthStrategy],
            authenticators: [PasswordAuthenticator, LoginLinkAuthenticator],
            twoFactorMethods: [OtpTwoFactorMethod, EmailTwoFactorMethod],
            twoFactorAtLogin: 'ifEnrolled',
            controllers: [LoginLinkTestAuthController, ProfileTestController],
            providers: providersWith()
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        releaseLinks();
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    describe('asking for a link', () => {
        it('answers an email with an account like one without, and makes the link after the answer', async () => {
            const user: JwtUser = await createUser('ada-asking');
            const unknown: string = 'nobody-asking@login-link.test';
            holdLinks();

            const known: Response = await requestLink(user.email);
            const unknownRes: Response = await requestLink(unknown);

            // the same answer, made from the same work: the lookup both cost, and nothing else before it
            expect([known.status, unknownRes.status]).toEqual([204, 204]);
            expect(await known.text()).toBe('');
            expect(await unknownRes.text()).toBe('');
            expect([...known.headers.keys()].sort()).toEqual([...unknownRes.headers.keys()].sort());
            expect(await tokensOf(user)).toHaveLength(0);

            releaseLinks();
            await waitUntil(async () => (await entriesOf(AuditAction.LOGIN_LINK_REQUESTED, user.email)).length === 1);
            await waitUntil(async () => (await entriesOf(AuditAction.LOGIN_LINK_REQUESTED, unknown)).length === 1);
            expect(await tokensOf(user)).toHaveLength(1);
            expect(await entriesOf(AuditAction.LOGIN_LINK_REQUESTED, user.email))
                .toMatchObject([{ outcome: AuditOutcome.SUCCESS, userId: user.id }]);
            expect(await entriesOf(AuditAction.LOGIN_LINK_REQUESTED, unknown))
                .toMatchObject([{ outcome: AuditOutcome.FAILURE, reason: AuditReason.NO_SUCH_SUBJECT }]);
        });

        it('mails a deactivated user no link', async () => {
            const user: JwtUser = await createUser('deactivated-asking');
            await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).deactivateUser(user.id, undefined);

            expect((await requestLink(user.email)).status).toBe(204);

            await waitUntil(async () => (await entriesOf(AuditAction.LOGIN_LINK_REQUESTED, user.email)).length === 1);
            expect(await entriesOf(AuditAction.LOGIN_LINK_REQUESTED, user.email))
                .toMatchObject([{ outcome: AuditOutcome.FAILURE, reason: AuditReason.DEACTIVATED, userId: user.id }]);
            expect(await tokensOf(user)).toHaveLength(0);
            await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
            expect(sendsTo(user.email)).toBe(0);
        });

        it('mails a service account no link', async () => {
            const service: JwtUser = await createServiceAccount('link-asking');

            expect((await requestLink(service.email)).status).toBe(204);

            await waitUntil(async () => (await entriesOf(AuditAction.LOGIN_LINK_REQUESTED, service.email)).length === 1);
            expect(await entriesOf(AuditAction.LOGIN_LINK_REQUESTED, service.email)).toMatchObject([{ outcome: AuditOutcome.FAILURE, reason: AuditReason.SERVICE_ACCOUNT, userId: service.id, userKind: 'service' }]);
            expect(await tokensOf(service)).toHaveLength(0);
            await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
            expect(sendsTo(service.email)).toBe(0);
        });

        it('refuses a service account a login, whatever credential an authenticator found it by', async () => {
            const service: JwtUser = await createServiceAccount('link-holding');
            // credentials a service account never gets through the framework, written past it
            await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
                .create({ userId: service.id, password: PASSWORD });
            await inject<Repository<LoginLinkToken, LoginLinkTokenCreateData>>(repositoryTokenFor(LoginLinkToken)).create({
                value: 'a-token-of-a-service-account',
                userId: service.id,
                expiresAt: new Date(Date.now() + Ms.MINUTE),
                browserBinding: null
            });

            const byPassword: Response = await logInWithPassword(service);
            const byLink: Response = await logInWithLink('a-token-of-a-service-account');

            expect(byPassword.status).toBe(403);
            expect((await byPassword.json() as ErrorBody).name).toBe('ServiceAccountRefusedError');
            expect(byLink.status).toBe(403);
            expect(await entriesOf(AuditAction.LOGIN, service.email)).toMatchObject([{ outcome: AuditOutcome.FAILURE, reason: AuditReason.SERVICE_ACCOUNT, userKind: 'service' }]);
        });

        it('binds the link to no browser by default', async () => {
            const user: JwtUser = await createUser('unbound');

            const { res, token } = await mailedLinkOf(user);

            expect(res.headers.getSetCookie().some(cookie => cookie.startsWith(`${BINDING_COOKIE}=`))).toBe(false);
            expect(await tokensOf(user)).toMatchObject([{ browserBinding: null }]);
            expect((await logInWithLink(token)).status).toBe(200);
        });

        it('replaces the link a user had with the new one', async () => {
            const user: JwtUser = await createUser('asking-twice');
            const first: string = (await mailedLinkOf(user)).token;
            const second: string = (await mailedLinkOf(user)).token;

            expect((await logInWithLink(first)).status).toBe(401);
            expect((await logInWithLink(second)).status).toBe(200);
        });
    });

    describe('logging in with a link', () => {
        it('logs in once, verifies the email, and records the use with the user', async () => {
            const user: JwtUser = await createUser('ada-logging-in');
            expect(user.emailVerifiedAt ?? undefined).toBeUndefined();
            const { token } = await mailedLinkOf(user);

            const res: Response = await logInWithLink(token);

            expect(res.status).toBe(200);
            expect((await res.json() as TokenBody).accessToken.value).toEqual(expect.any(String));
            const again: Response = await logInWithLink(token);
            expect(again.status).toBe(401);
            expect((await again.json() as ErrorBody).message).toBe('This login link is unknown or was used already. Ask for a new one.');
            const verified: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).findById(user.id);
            expect(verified.emailVerifiedAt).toBeInstanceOf(Date);
            expect(await entriesOfUser(AuditAction.LOGIN_LINK_USED, user.id)).toMatchObject([{ outcome: AuditOutcome.SUCCESS }]);
            expect(await entriesOfUser(AuditAction.LOGIN, user.id)).toMatchObject([{ outcome: AuditOutcome.SUCCESS }]);
        });

        it('refuses an expired link', async () => {
            const user: JwtUser = await createUser('expired');
            await inject<Repository<LoginLinkToken, LoginLinkTokenCreateData>>(repositoryTokenFor(LoginLinkToken)).create({
                value: 'an-expired-token',
                userId: user.id,
                expiresAt: new Date(Date.now() - 1000),
                browserBinding: null
            });

            const res: Response = await logInWithLink('an-expired-token');

            expect(res.status).toBe(401);
            expect((await res.json() as ErrorBody).message).toBe('This login link expired. Ask for a new one.');
            expect(await tokensOf(user)).toHaveLength(0);
        });

        it('refuses the link of a user deactivated since it was sent', async () => {
            const user: JwtUser = await createUser('deactivated-since');
            const { token } = await mailedLinkOf(user);
            await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).deactivateUser(user.id, undefined);

            expect((await logInWithLink(token)).status).toBe(403);
        });

        it('takes no GET, so a scanner opening the link spends nothing', async () => {
            const user: JwtUser = await createUser('scanned');
            const { token } = await mailedLinkOf(user);

            expect((await fetch(`${baseUrl}/auth/login?authenticator=login-link&token=${token}`)).status).not.toBe(200);
            expect((await logInWithLink(token)).status).toBe(200);
        });

        it('does not count as a recent login, refreshed or not, which one with a password does', async () => {
            const user: JwtUser = await createUser('recent');
            const { token } = await mailedLinkOf(user);
            const linked: TokenBody = await (await logInWithLink(token)).json() as TokenBody;

            const refused: Response = await readAddress({ authorization: `Bearer ${linked.accessToken.value}` });
            expect(refused.status).toBe(401);
            expect((await refused.json() as ErrorBody).name).toBe('ReauthenticationRequiredError');

            const refreshed: TokenBody = await (await fetch(`${baseUrl}/auth/refresh-login?strategy=jwt`, {
                method: 'POST',
                headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
                body: JsonUtilities.stringify({ refreshToken: linked.refreshToken.value })
            })).json() as TokenBody;
            expect((await readAddress({ authorization: `Bearer ${refreshed.accessToken.value}` })).status).toBe(401);

            const withPassword: TokenBody = await (await logInWithPassword(user)).json() as TokenBody;
            expect((await readAddress({ authorization: `Bearer ${withPassword.accessToken.value}` })).status).toBe(200);
        });

        it('does not count as a recent login for a user with a second factor and no password', async () => {
            const user: JwtUser = await createUserWithoutPassword('recent-otp');
            await enrollOtp(user);
            const { token } = await mailedLinkOf(user);
            const { ticket }: PendingLoginBody = await (await logInWithLink(token)).json() as PendingLoginBody;
            const linked: TokenBody = await (await continueWith('/confirm?strategy=jwt', ticket, {
                [inject(ZIBRI_DI_TOKENS.OTP_HEADER)]: new TOTP({ secret: OTP_SECRET }).generate()
            })).json() as TokenBody;

            const refused: Response = await readAddress({ authorization: `Bearer ${linked.accessToken.value}` });

            expect(refused.status).toBe(401);
            expect((await refused.json() as ErrorBody).name).toBe('SecondFactorMissingError');
        });

        it('counts as a recent login for a user with neither a password nor a second factor, refreshed too', async () => {
            const user: JwtUser = await createUserWithoutPassword('link-only');
            const linked: TokenBody = await (await logInWithLink((await mailedLinkOf(user)).token)).json() as TokenBody;

            expect((await readAddress({ authorization: `Bearer ${linked.accessToken.value}` })).status).toBe(200);
            const refreshed: TokenBody = await (await fetch(`${baseUrl}/auth/refresh-login?strategy=jwt`, {
                method: 'POST',
                headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
                body: JsonUtilities.stringify({ refreshToken: linked.refreshToken.value })
            })).json() as TokenBody;
            expect((await readAddress({ authorization: `Bearer ${refreshed.accessToken.value}` })).status).toBe(200);

            const fresh: TokenBody = await (await logInWithLink((await mailedLinkOf(user)).token)).json() as TokenBody;
            expect((await readAddress({ authorization: `Bearer ${fresh.accessToken.value}` })).status).toBe(200);
        });

        it('tells a user with nothing but links to ask for a new one once the login is too old, and others to log in again', async () => {
            const linkOnly: JwtUser = await createUserWithoutPassword('link-only-too-old');
            const linked: TokenBody = await (await logInWithLink((await mailedLinkOf(linkOnly)).token)).json() as TokenBody;
            const withPassword: JwtUser = await createUser('password-too-old');
            const loggedIn: TokenBody = await (await logInWithPassword(withPassword)).json() as TokenBody;
            await new Promise(resolve => setTimeout(resolve, 1100));

            const linkOnlyRes: Response = await fetch(`${baseUrl}/profile/iban`, { headers: { authorization: `Bearer ${linked.accessToken.value}` } });
            const passwordRes: Response = await fetch(`${baseUrl}/profile/iban`, { headers: { authorization: `Bearer ${loggedIn.accessToken.value}` } });

            expect(linkOnlyRes.status).toBe(401);
            expect((await linkOnlyRes.json() as ErrorBody).message).toBe('Ask for a new login link, and log in with it to access this route.');
            expect(passwordRes.status).toBe(401);
            expect((await passwordRes.json() as ErrorBody).message).toBe('Log in again to access this route.');
        });

        it('does not count as a recent login with cookies either', async () => {
            const user: JwtUser = await createUser('recent-cookie');
            const { token } = await mailedLinkOf(user);

            const linked: Response = await logInWithLink(token, 'cookie');
            expect(linked.status).toBe(200);
            expect((await readAddress({ cookie: cookiesOf(linked) })).status).toBe(401);

            const withPassword: Response = await logInWithPassword(user, 'cookie');
            expect((await readAddress({ cookie: cookiesOf(withPassword) })).status).toBe(200);
        });
    });

    describe('the second factor, following twoFactorAtLogin by default', () => {
        it('asks an enrolled user for it, and completes with it', async () => {
            const user: JwtUser = await createUser('otp-user');
            await enrollOtp(user);
            const { token } = await mailedLinkOf(user);

            const res: Response = await logInWithLink(token);

            expect(res.status).toBe(401);
            const body: PendingLoginBody = await res.json() as PendingLoginBody;
            expect(body).toMatchObject({ name: 'SecondFactorRequiredError', methods: ['otp'] });
            const done: Response = await continueWith('/confirm?strategy=jwt', body.ticket, {
                [inject(ZIBRI_DI_TOKENS.OTP_HEADER)]: new TOTP({ secret: OTP_SECRET }).generate()
            });
            expect(done.status).toBe(200);
            // the link was spent by the login it started, which waited for the factor
            expect((await logInWithLink(token)).status).toBe(401);
        });

        it('does not count codes by email, which prove the mailbox the link did', async () => {
            const user: JwtUser = await createUser('otp-and-email');
            await enrollOtp(user);
            await enrollEmail(user);
            const { token } = await mailedLinkOf(user);

            const body: PendingLoginBody = await (await logInWithLink(token)).json() as PendingLoginBody;

            expect(body.methods).toEqual(['otp']);
            expect((await continueWith('/request?method=email', body.ticket)).status).toBe(403);
        });

        it('logs a user whose only factor is codes by email in on the link, as one without a factor', async () => {
            const user: JwtUser = await createUser('email-only-if-enrolled');
            await enrollEmail(user);
            const { token } = await mailedLinkOf(user);

            expect((await logInWithLink(token)).status).toBe(200);
        });

        describe('required', () => {
            beforeAll(async () => {
                await restartWith({}, 'required');
            }, TestTimeouts.inMemory.start);

            it('has a user whose only factor is codes by email enroll another one to finish', async () => {
                const user: JwtUser = await createUser('email-only-required');
                await enrollEmail(user);
                const { token } = await mailedLinkOf(user);

                const res: Response = await logInWithLink(token);

                expect(res.status).toBe(401);
                const body: PendingLoginBody = await res.json() as PendingLoginBody;
                expect(body.methods).toEqual([]);
                expect((await continueWith('/registration/request?method=email', body.ticket)).status).toBe(403);
                const registered: Response = await continueWith('/registration/request?method=otp', body.ticket);
                expect(registered.status).toBe(200);
                const { secret }: { secret: string } = await registered.json() as { secret: string };
                const code: string = new TOTP({ secret }).generate();
                const confirmed: Response = await fetch(`${baseUrl}/auth/login/2fa/registration/confirm?method=otp`, {
                    method: 'POST',
                    headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON, [inject(ZIBRI_DI_TOKENS.LOGIN_TICKET_HEADER)]: body.ticket },
                    body: JsonUtilities.stringify({ token: code })
                });
                expect(confirmed.status).toBe(204);
                const done: Response = await continueWith('/confirm?strategy=jwt', body.ticket, {
                    [inject(ZIBRI_DI_TOKENS.OTP_HEADER)]: code
                });
                expect(done.status).toBe(200);
            });
        });

        describe('with secondFactor none', () => {
            beforeAll(async () => {
                await restartWith({ secondFactor: 'none' }, 'required');
            }, TestTimeouts.inMemory.start);

            it('logs an enrolled user in on the link alone', async () => {
                const user: JwtUser = await createUser('none-asked');
                await enrollOtp(user);
                const { token } = await mailedLinkOf(user);

                expect((await logInWithLink(token)).status).toBe(200);
                // a password login still asks
                expect((await logInWithPassword(user)).status).toBe(401);
            });
        });
    });

    describe('bound to the browser', () => {
        beforeAll(async () => {
            await restartWith({ bindToBrowser: true });
        }, TestTimeouts.inMemory.start);

        it('sets a cookie whether or not the email has an account', async () => {
            const res: Response = await requestLink('nobody-bound@login-link.test');

            const cookie: string | undefined = res.headers.getSetCookie().find(c => c.startsWith(`${BINDING_COOKIE}=`));
            expect(cookie).toMatch(/HttpOnly/);
            expect(cookie).toMatch(/SameSite=Lax/);
        });

        it('refuses the link in a browser without the cookie, and takes it in the one that asked', async () => {
            const user: JwtUser = await createUser('bound');
            const { res, token } = await mailedLinkOf(user);

            const elsewhere: Response = await logInWithLink(token);
            expect(elsewhere.status).toBe(401);
            expect((await elsewhere.json() as ErrorBody).message)
                .toBe('This login link works on the device it was asked for on. Open it there, or ask for a new one on this device.');
            expect((await logInWithLink(token, 'jwt', { cookie: `${BINDING_COOKIE}=another-browser` })).status).toBe(401);

            expect((await logInWithLink(token, 'jwt', { cookie: cookiesOf(res) })).status).toBe(200);
        });
    });

    describe('the rate limit', () => {
        beforeAll(async () => {
            await restartWith({}, 'ifEnrolled', 3);
        }, TestTimeouts.inMemory.start);

        it('refuses an email asked for beyond its budget, from whichever caller', async () => {
            const authenticator: LoginLinkAuthenticator<string> = inject(LoginLinkAuthenticator);
            const email: string = 'limited@login-link.test';
            for (let i: number = 0; i < 3; i++) {
                await authenticator.requestLoginLink(email);
            }

            await expect(authenticator.requestLoginLink(email)).rejects.toMatchObject({ status: 429 });
            await expect(authenticator.requestLoginLink('Limited@Login-Link.test ')).rejects.toMatchObject({ status: 429 });
        });

        it('refuses a caller beyond its budget, whichever emails it asks for', async () => {
            const statuses: number[] = [];
            for (let i: number = 0; i < 4; i++) {
                statuses.push((await requestLink(`caller-${i}@login-link.test`)).status);
            }

            expect(statuses).toEqual([204, 204, 204, 429]);
        });
    });

    describe('GET /auth/login-methods', () => {
        it('is not there unless the controller asks for it', async () => {
            expect('getLoginMethods' in LoginLinkTestAuthController.prototype).toBe(false);
            expect((await fetch(`${baseUrl}/auth/login-methods`)).status).toBe(404);
        });

        it('answers the ways the login route takes once it is asked for', async () => {
            await server.reInit({ controllers: [LoginMethodsTestAuthController, ProfileTestController], providers: providersWith() });
            baseUrl = await server.start();

            const res: Response = await fetch(`${baseUrl}/auth/login-methods`);

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ password: true, loginLink: true });
        }, TestTimeouts.inMemory.start);
    });
});