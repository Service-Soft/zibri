import assert from 'node:assert';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { CookieAuthCredentials } from './cookie-auth-credentials.model';
import { CookieAuthRefreshSession } from './cookie-auth-refresh-session.model';
import { CookieAuthSession } from './cookie-auth-session.model';
import { CookieAuthStrategy } from './cookie-auth.auth-strategy';
import { CookieAuthController } from './cookie-auth.controller';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { createTestDataSource, defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook } from '../../../data-source/hooks/hooks.default';
import { Repository } from '../../../data-source/repository';
import { InjectRepository, repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
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
// eslint-disable-next-line unusedImports/no-unused-vars
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

    const email: string = 'cookie-auth-test@example.com';
    const password: string = 'secure123';

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
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' })
            ]
        });
        baseUrl = await server.start();
        userRepo = inject(repositoryTokenFor(JwtUser));
        credentialsRepo = inject(repositoryTokenFor(CookieAuthCredentials));
        sessionRepo = inject(repositoryTokenFor(CookieAuthSession));
        refreshSessionRepo = inject(repositoryTokenFor(CookieAuthRefreshSession));
        resetTokenRepo = inject(repositoryTokenFor(PasswordResetToken));
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
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
            // same family, same csrf token — only the underlying session/refresh rows are rotated
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(rotated.csrfToken).toBe(body.csrfToken);

            // eslint-disable-next-line typescript/no-unsafe-member-access
            const sessions: CookieAuthSession[] = await sessionRepo.findAll({ where: { userId: body.userId as string } });
            expect(sessions).toHaveLength(2);
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
                { where: { userId: body.userId as string } },
                false
            );
            assert(refreshSession);

            const res: Response = await fetch(`${baseUrl}/auth/logout`, {
                method: 'POST',
                headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ clearCookies: true, refreshSessionId: refreshSession.id })
            });
            expect(res.status).toBe(200);

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
            expect(requestRes.status).toBe(200);

            const user: JwtUser = await userRepo.findOne({ where: { email } });
            const tokens: PasswordResetToken[] = await resetTokenRepo.findAll({ where: { userId: user.id } });
            expect(tokens).toHaveLength(1);

            const verifyRes: Response = await fetch(`${baseUrl}/auth/verify-password-reset-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetToken: tokens[0].value })
            });
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/typedef
            const verifyBody = await verifyRes.json();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(verifyBody.isValid).toBe(true);

            const confirmRes: Response = await fetch(`${baseUrl}/auth/confirm-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetToken: tokens[0].value, newPassword: 'newPass456' })
            });
            expect(confirmRes.status).toBe(200);

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

        it('rejects a second request while a reset token is already active', async () => {
            const firstRes: Response = await fetch(`${baseUrl}/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            expect(firstRes.status).toBe(200);

            const secondRes: Response = await fetch(`${baseUrl}/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            expect(secondRes.status).toBe(429);
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