import assert from 'node:assert';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { CookieAuthCredentials } from './cookie-auth-credentials.model';
import { CookieAuthRefreshSession } from './cookie-auth-refresh-session.model';
import { CookieAuthSession } from './cookie-auth-session.model';
import { CookieAuthSessionOptionsInput, CookieAuthStrategy } from './cookie-auth.auth-strategy';
import { CookieAuthController } from './cookie-auth.controller';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { createTestDataSource, defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook } from '../../../data-source/hooks/hooks.default';
import { Repository } from '../../../data-source/repository/repository';
import { InjectRepository, repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { Email } from '../../../email/models/email.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { Auth } from '../../decorators/auth.decorator';
import { UserRepo } from '../../decorators/user-repo.decorator';
import { PasswordResetToken } from '../../models/password-reset-token.model';
import { UserRepositoryInterface } from '../../user/user-repository.interface';

// Separate from the shared DefaultTestServerUserRepository (which resolves JwtCredentials) — UserService tries
// every registered @UserRepo() and uses whichever one's resolveCredentialsFor() resolves, so both can coexist.
@UserRepo()
class CookieTestUserRepository extends Repository<JwtUser>
    implements UserRepositoryInterface<Roles, JwtUser, CookieAuthCredentials> {
    constructor(
        @InjectRepository(JwtUser)
        repo: Repository<JwtUser>,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        logger: LoggerInterface,
        @InjectRepository(CookieAuthCredentials)
        private readonly credentialsRepository: Repository<CookieAuthCredentials>
    ) {
        super(JwtUser, repo, logger, repo.dataSource, getDefaultBeforeSaveHook(), getDefaultBeforeReturnHook());
    }

    async findByEmail(email: string): Promise<JwtUser> {
        return await this.findOne({ where: { email } });
    }

    async resolveCredentialsFor(user: JwtUser): Promise<CookieAuthCredentials> {
        return await this.credentialsRepository.findOne({ where: { userId: user.id } });
    }
}
// the class exists to be registered by @UserRepo, which happens when it is declared. The reference
// is only so that it does not read as dead code to a compiler that cannot know that
void CookieTestUserRepository;

@Controller('/cookie-test')
class CookieProtectedController {
    @Get('/me')
    @Auth.isLoggedIn([CookieAuthStrategy])
    me(): { ok: boolean } {
        return { ok: true };
    }
}

function extractCookieHeader(res: Response): string {
    return res.headers.getSetCookie()
        .map(line => line.split(';')[0])
        .join('; ');
}

type LoginResult = {
    res: Response,
    cookieHeader: string,
    // eslint-disable-next-line typescript/no-explicit-any
    body: any
};

describe('CookieAuthController / CookieAuthStrategy — real HTTP flow', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let userRepo: Repository<JwtUser>;
    let credentialsRepo: Repository<CookieAuthCredentials>;
    let sessionRepo: Repository<CookieAuthSession>;
    let refreshSessionRepo: Repository<CookieAuthRefreshSession>;
    let resetTokenRepo: Repository<PasswordResetToken>;
    let emailRepo: Repository<Email>;

    const email: string = 'cookie-auth-test@example.com';
    const password: string = 'secure123';

    /**
     * The reset token as the user gets it: out of the link in the email.
     *
     * The stored value is hashed, so the database no longer holds anything that can be presented
     * back to the api - which is the point of hashing it.
     * @returns The token from the most recently queued password reset email.
     */
    async function resetTokenFromEmail(): Promise<string> {
        const emails: Email[] = await emailRepo.findAll({ where: { recipients: { includes: [email] } } });
        const link: RegExpExecArray | null = /confirm-password-reset\/([\da-f]+)/.exec(emails.at(-1)?.html ?? '');
        if (!link?.[1]) {
            throw new Error('no password reset link was mailed');
        }
        return link[1];
    }

    beforeAll(async () => {
        server = await startTestServer({
            authStrategies: [CookieAuthStrategy],
            controllers: [CookieAuthController, CookieProtectedController],
            dataSources: [
                createTestDataSource({
                    entities: [...defaultTestServerEntities, CookieAuthCredentials, CookieAuthSession, CookieAuthRefreshSession]
                })
            ],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
                // the session cookie says `secure: true` outright while the refresh cookie leaves it
                // to be derived, so one response shows both. This server is plain http, so derivation
                // says false - which is what makes the override observable at all.
                defineProvider({
                    token: ZIBRI_DI_TOKENS.COOKIE_AUTH_SESSION_OPTIONS,
                    useFactory: (): CookieAuthSessionOptionsInput => ({
                        name: 'sessionId',
                        sameSite: 'lax',
                        path: '/',
                        secure: true
                    })
                })
            ]
        });
        baseUrl = await server.start();
        userRepo = inject(repositoryTokenFor(JwtUser));
        credentialsRepo = inject(repositoryTokenFor(CookieAuthCredentials));
        sessionRepo = inject(repositoryTokenFor(CookieAuthSession));
        refreshSessionRepo = inject(repositoryTokenFor(CookieAuthRefreshSession));
        resetTokenRepo = inject(repositoryTokenFor(PasswordResetToken));
        emailRepo = inject(repositoryTokenFor(Email));
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        await emailRepo.deleteAll({});
        await sessionRepo.deleteAll({});
        await refreshSessionRepo.deleteAll({});
        await resetTokenRepo.deleteAll({});
        await credentialsRepo.deleteAll({});
        await userRepo.deleteAll({});

        const user: JwtUser = await userRepo.create({ email, roles: [Roles.USER] });
        await credentialsRepo.create({ email, password, userId: user.id });
    });

    async function login(): Promise<LoginResult> {
        const res: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const cookieHeader: string = extractCookieHeader(res);
        // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/typedef
        const body = await res.json();
        // eslint-disable-next-line typescript/no-unsafe-assignment
        return { res, cookieHeader, body };
    }

    describe('login', () => {
        it('sets the session and refresh cookies and returns the auth data', async () => {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const { res, cookieHeader, body } = await login();
            expect(res.status).toBe(200);
            expect(cookieHeader).toContain('sessionId=');
            expect(cookieHeader).toContain('refreshSessionId=');

            // this server is plain http. The session cookie asks for Secure outright and gets it;
            // the refresh cookie leaves it to be derived and correctly does not - which is the
            // difference the option exists to let a https-only deployment state, rather than
            // trusting a trustProxy setting to have been got right.
            const setCookies: string[] = res.headers.getSetCookie();
            expect(setCookies.find(c => c.startsWith('sessionId='))).toContain('Secure');
            expect(setCookies.find(c => c.startsWith('refreshSessionId='))).not.toContain('Secure');
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(body.roles).toEqual([Roles.USER]);
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(body.csrfToken).toBeTruthy();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(body.userId).toBeTruthy();
        });

        it('rejects a login with the wrong password', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password: 'wrong-password' })
            });
            expect(res.status).toBe(401);
        });

        it('rejects a login for an unknown email', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'nobody@example.com', password })
            });
            expect(res.status).toBe(401);
        });
    });

    describe('session cookie authentication', () => {
        it('authenticates a protected route using the session cookie', async () => {
            const { cookieHeader } = await login();
            const res: Response = await fetch(`${baseUrl}/cookie-test/me`, { headers: { Cookie: cookieHeader } });
            expect(res.status).toBe(200);
        });

        it('rejects a protected route without a session cookie', async () => {
            const res: Response = await fetch(`${baseUrl}/cookie-test/me`);
            expect(res.status).toBe(401);
        });
    });

    describe('refresh-login', () => {
        it('rejects a refresh without a matching CSRF header', async () => {
            const { cookieHeader } = await login();
            const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: '{}'
            });
            expect(res.status).toBe(401);
        });

        it('returns fresh data for the same session when it is still valid and the CSRF token matches', async () => {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const { cookieHeader, body } = await login();
            const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                // eslint-disable-next-line typescript/no-unsafe-member-access
                headers: { Cookie: cookieHeader, 'Content-Type': 'application/json', 'x-csrf-token': body.csrfToken as string },
                body: '{}'
            });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/typedef
            const refreshed = await res.json();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(refreshed.userId).toBe(body.userId);
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(refreshed.csrfToken).toBe(body.csrfToken);
        });

        it('rotates the session when the access session has expired but the refresh session is still valid', async () => {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const { cookieHeader, body } = await login();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            await sessionRepo.updateAll({ userId: body.userId as string }, { expirationDate: new Date(Date.now() - 1000) });

            const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                // eslint-disable-next-line typescript/no-unsafe-member-access
                headers: { Cookie: cookieHeader, 'Content-Type': 'application/json', 'x-csrf-token': body.csrfToken as string },
                body: '{}'
            });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/typedef
            const rotated = await res.json();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(rotated.userId).toBe(body.userId);
            // same family, new csrf token. It used to be carried over, which left one token valid for
            // the whole life of the family and replaced by nothing, re-authentication included.
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(rotated.csrfToken).not.toBe(body.csrfToken);
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(rotated.csrfToken).toBeTruthy();
            // and in the header too, because a session that renews itself mid-request has no
            // response body of its own to put it in
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(res.headers.get('x-csrf-token')).toBe(rotated.csrfToken);

            // eslint-disable-next-line typescript/no-unsafe-member-access
            const sessions: CookieAuthSession[] = await sessionRepo.findAll({ where: { userId: body.userId as string } });
            expect(sessions).toHaveLength(2);
        });

        it('refuses the csrf token that rotation retired, and accepts the new one', async () => {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const { cookieHeader, body } = await login();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            await sessionRepo.updateAll({ userId: body.userId as string }, { expirationDate: new Date(Date.now() - 1000) });

            const rotateRes: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                // eslint-disable-next-line typescript/no-unsafe-member-access
                headers: { Cookie: cookieHeader, 'Content-Type': 'application/json', 'x-csrf-token': body.csrfToken as string },
                body: '{}'
            });
            const rotatedCookies: string = extractCookieHeader(rotateRes);
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/typedef
            const rotated = await rotateRes.json();

            // rotating without retiring the old token would be bookkeeping rather than a fix
            const withOldToken: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                // eslint-disable-next-line typescript/no-unsafe-member-access
                headers: { Cookie: rotatedCookies, 'Content-Type': 'application/json', 'x-csrf-token': body.csrfToken as string },
                body: '{}'
            });
            expect(withOldToken.status).toBe(401);

            const withNewToken: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                // eslint-disable-next-line typescript/no-unsafe-member-access
                headers: { Cookie: rotatedCookies, 'Content-Type': 'application/json', 'x-csrf-token': rotated.csrfToken as string },
                body: '{}'
            });
            expect(withNewToken.status).toBe(200);
        });

        it('rejects a refresh once the refresh session itself has expired', async () => {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const { cookieHeader, body } = await login();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            await refreshSessionRepo.updateAll({ userId: body.userId as string }, { expirationDate: new Date(Date.now() - 1000) });

            const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                // eslint-disable-next-line typescript/no-unsafe-member-access
                headers: { Cookie: cookieHeader, 'Content-Type': 'application/json', 'x-csrf-token': body.csrfToken as string },
                body: '{}'
            });
            expect(res.status).toBe(401);
        });

        it('rejects a refresh once the refresh session has been blacklisted', async () => {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const { cookieHeader, body } = await login();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            await refreshSessionRepo.updateAll({ userId: body.userId as string }, { blacklisted: true });

            const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                // eslint-disable-next-line typescript/no-unsafe-member-access
                headers: { Cookie: cookieHeader, 'Content-Type': 'application/json', 'x-csrf-token': body.csrfToken as string },
                body: '{}'
            });
            expect(res.status).toBe(401);
        });
    });

    describe('logout', () => {
        it('deletes the session so a subsequent request with the same cookie is rejected', async () => {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const { cookieHeader, body } = await login();
            const refreshSession: CookieAuthRefreshSession | undefined = await refreshSessionRepo.findOne(
                // eslint-disable-next-line typescript/no-unsafe-member-access
                { where: { userId: body.userId as string }, required: false }
            );
            assert(refreshSession);

            const res: Response = await fetch(`${baseUrl}/auth/logout`, {
                method: 'POST',
                headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ clearCookies: true, refreshSessionId: refreshSession.id })
            });
            expect(res.status).toBe(204);

            const meRes: Response = await fetch(`${baseUrl}/cookie-test/me`, { headers: { Cookie: cookieHeader } });
            expect(meRes.status).toBe(401);

            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(await sessionRepo.findAll({ where: { userId: body.userId as string } })).toHaveLength(0);
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(await refreshSessionRepo.findAll({ where: { userId: body.userId as string } })).toHaveLength(0);
        });
    });

    describe('password reset', () => {
        it('creates a token on request, accepts it on verify, and changing the password invalidates the old one', async () => {
            const requestRes: Response = await fetch(`${baseUrl}/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            expect(requestRes.status).toBe(204);

            const user: JwtUser = await userRepo.findOne({ where: { email } });
            const tokens: PasswordResetToken[] = await resetTokenRepo.findAll({ where: { userId: user.id } });
            expect(tokens).toHaveLength(1);

            // from the mail rather than from the row: the stored value is a hash, so this is the only
            // place the token exists
            const resetToken: string = await resetTokenFromEmail();

            const verifyRes: Response = await fetch(`${baseUrl}/auth/verify-password-reset-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetToken })
            });
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/typedef
            const verifyBody = await verifyRes.json();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(verifyBody.isValid).toBe(true);

            const confirmRes: Response = await fetch(`${baseUrl}/auth/confirm-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetToken, newPassword: 'newPass456' })
            });
            expect(confirmRes.status).toBe(204);

            const oldLoginRes: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            expect(oldLoginRes.status).toBe(401);

            const newLoginRes: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password: 'newPass456' })
            });
            expect(newLoginRes.status).toBe(200);
        });

        it('ignores a second request while a reset token is already active', async () => {
            const firstRes: Response = await fetch(`${baseUrl}/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            expect(firstRes.status).toBe(204);

            const secondRes: Response = await fetch(`${baseUrl}/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            // this used to answer 429, which named an address that exists and had recently been
            // asked about. One live token is still the rule; refusing is now silent.
            expect(secondRes.status).toBe(204);
            expect(await resetTokenRepo.findAll({})).toHaveLength(1);
        });

        it('verify-password-reset-token returns isValid: false for an unknown token', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/verify-password-reset-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetToken: 'not-a-real-token' })
            });
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/typedef
            const body = await res.json();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(body.isValid).toBe(false);
        });

        it('confirm-password-reset rejects an unknown token', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/confirm-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetToken: 'not-a-real-token', newPassword: 'whatever123' })
            });
            expect(res.status).toBe(401);
        });
    });
});