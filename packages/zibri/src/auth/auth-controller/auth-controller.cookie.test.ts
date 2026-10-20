import assert from 'node:assert';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDataSource } from 'zibri-testing';

import { CookieTestAuthController } from '../../__testing__/mocks/controllers/cookie-test-auth.controller.ts';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../__testing__/mocks/entities/roles.enum.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { DataSource } from '../../data-source/decorators/data-source.decorator.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { Email } from '../../email/models/email.model.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Get } from '../../routing/decorators/get.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../authenticators/password/password-credentials.model.ts';
import { Auth } from '../decorators/auth.decorator.ts';
import { PASSWORD_MAX_LENGTH } from '../hash/hash.utilities.ts';
import { PasswordResetToken } from '../models/password-reset-token.model.ts';
import { CookieAuthRefreshSession } from '../strategies/cookie/cookie-auth-refresh-session.model.ts';
import { CookieAuthSession } from '../strategies/cookie/cookie-auth-session.model.ts';
import { CookieAuthSessionOptionsInput, CookieAuthStrategy } from '../strategies/cookie/cookie-auth.auth-strategy.ts';

@Controller('/cookie-test')
class CookieProtectedController {
    @Get('/me')
    @Auth.isLoggedIn([CookieAuthStrategy])
    me(): { ok: boolean } {
        return { ok: true };
    }

    @Get('/reauth')
    @Auth.require2fa({ reauth: true })
    reauth(): { ok: boolean } {
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

// allowed to go unused, because only the starting case boots it
@DataSource({ allowOrphan: true })
class WithoutCookieSessionsDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
}

// first, since the main suite declares a data source that every later boot would be refused for
describe('CookieAuthStrategy — starting', () => {
    it('refuses to start without its entities, and names them', async () => {
        const start: Promise<StartedTestServer> = startTestServer({
            authStrategies: [CookieAuthStrategy],
            controllers: [CookieTestAuthController, CookieProtectedController],
            dataSources: [WithoutCookieSessionsDataSource],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' })
            ]
        });

        await expect(start).rejects.toThrow(/Error initializing CookieAuthStrategy[\S\s]*CookieAuthSession[\S\s]*CookieAuthRefreshSession/);
    }, 30000);
});

describe('AuthController / CookieAuthStrategy — real HTTP flow', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let userRepo: Repository<JwtUser>;
    let credentialsRepo: Repository<PasswordCredentials, PasswordCredentialsCreateData>;
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
            controllers: [CookieTestAuthController, CookieProtectedController],
            dataSources: [
                createTestDataSource({
                    entities: [...defaultTestServerEntities, CookieAuthSession, CookieAuthRefreshSession]
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
        credentialsRepo = inject(repositoryTokenFor(PasswordCredentials));
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
        await credentialsRepo.create({ password, userId: user.id });
    });

    async function login(): Promise<LoginResult> {
        const res: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({ email, password })
        });
        const cookieHeader: string = extractCookieHeader(res);
        // eslint-disable-next-line typescript/no-unsafe-assignment, typescript-js/typedef
        const body = await res.json();
        // eslint-disable-next-line typescript/no-unsafe-assignment
        return { res, cookieHeader, body };
    }

    describe('a recent login', () => {
        it('lets a fresh login stand in for a second factor, and not one from long ago', async () => {
            const { cookieHeader } = await login();
            const fresh: Response = await fetch(`${baseUrl}/cookie-test/reauth`, { headers: { Cookie: cookieHeader } });
            expect(fresh.status).toBe(200);

            // the same session, logged in long ago as far as its family knows
            await refreshSessionRepo.updateAll({}, { authenticatedAt: new Date(0) });
            const old: Response = await fetch(`${baseUrl}/cookie-test/reauth`, { headers: { Cookie: cookieHeader } });
            expect(old.status).toBe(401);
        });

        it('keeps the time of the login when a lapsed session is rotated', async () => {
            const { cookieHeader } = await login();
            const [loggedIn] = await refreshSessionRepo.findAll({});
            assert(loggedIn);
            await sessionRepo.updateAll({}, { expirationDate: new Date(Date.now() - 1000) });

            // the lapsed session is replaced inside this request, and the route still reads the login
            // time - rotating twice in one request would present a spent refresh session and end it
            const res: Response = await fetch(`${baseUrl}/cookie-test/reauth`, { headers: { Cookie: cookieHeader } });
            expect(res.status).toBe(200);

            const rotated: CookieAuthRefreshSession[] = await refreshSessionRepo.findAll({});
            expect(rotated).toHaveLength(2);
            expect(rotated.map(r => new Date(r.authenticatedAt).getTime()))
                .toEqual([loggedIn.authenticatedAt, loggedIn.authenticatedAt].map(d => new Date(d).getTime()));
        });
    });

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

        it('does not take whether the connection is secure from a header the client sent', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
                body: JsonUtilities.stringify({ email, password })
            });
            expect(res.status).toBe(200);

            // nothing in front of this server overwrote the header and trustProxy is not set, so it
            // is the caller's word. The derived flag used to fall back to reading it, so a proxy
            // that passed `http` through - or a client that sent it - decided the cookie's Secure
            expect(res.headers.getSetCookie().find(c => c.startsWith('refreshSessionId='))).not.toContain('Secure');
        });

        it('rejects a login with the wrong password', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email, password: 'wrong-password' })
            });
            expect(res.status).toBe(401);
        });

        it('rejects a login for an unknown email', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email: 'nobody@example.com', password })
            });
            expect(res.status).toBe(401);
        });

        it('refuses a password longer than the cap, and compares one at the cap', async () => {
            const tooLong: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email, password: 'a'.repeat(PASSWORD_MAX_LENGTH + 1) })
            });
            expect(tooLong.status).toBe(400);

            const atCap: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email, password: 'a'.repeat(PASSWORD_MAX_LENGTH) })
            });
            expect(atCap.status).toBe(401);
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
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript-js/typedef
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
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript-js/typedef
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
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript-js/typedef
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

    describe('csrf-token', () => {
        it('hands a client holding only the cookies the token that refresh-login asks for', async () => {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const { cookieHeader, body } = await login();

            // a page reload: the cookies survived, the token kept in memory did not
            const res: Response = await fetch(`${baseUrl}/auth/csrf-token`, { headers: { Cookie: cookieHeader } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript-js/typedef
            const answer = await res.json();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(answer.csrfToken).toBe(body.csrfToken);

            const refreshRes: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                // eslint-disable-next-line typescript/no-unsafe-member-access
                headers: { Cookie: cookieHeader, 'Content-Type': 'application/json', 'x-csrf-token': answer.csrfToken as string },
                body: '{}'
            });
            expect(refreshRes.status).toBe(200);
        });

        it('answers with the token of the renewed session when the session had lapsed', async () => {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const { cookieHeader, body } = await login();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            await sessionRepo.updateAll({ userId: body.userId as string }, { expirationDate: new Date(Date.now() - 1000) });

            const res: Response = await fetch(`${baseUrl}/auth/csrf-token`, { headers: { Cookie: cookieHeader } });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript-js/typedef
            const answer = await res.json();
            // the retired one would be refused by the very next unsafe request
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(answer.csrfToken).not.toBe(body.csrfToken);
            // and is the token of the renewed session, which an unsafe request with its cookies passes on
            const refreshRes: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                // eslint-disable-next-line typescript/no-unsafe-member-access
                headers: { Cookie: extractCookieHeader(res), 'Content-Type': 'application/json', 'x-csrf-token': answer.csrfToken as string },
                body: '{}'
            });
            expect(refreshRes.status).toBe(200);
        });

        it('refuses a request without a session', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/csrf-token`);
            expect(res.status).toBe(401);
        });
    });

    describe('what the tables hold', () => {
        it('holds nothing a request could present as a session or a csrf token', async () => {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const { res, body } = await login();
            // a signed cookie is `s:<value>.<signature>`, url encoded
            const presented: string[] = res.headers.getSetCookie()
                .map(line => decodeURIComponent(line.split(';')[0]?.split('=')[1] ?? ''))
                .map(value => value.slice(2, value.lastIndexOf('.')));
            expect(presented).toHaveLength(2);

            const stored: string = JsonUtilities.stringify([...await sessionRepo.findAll({}), ...await refreshSessionRepo.findAll({})]);
            // eslint-disable-next-line typescript/no-unsafe-member-access
            for (const value of [...presented, body.csrfToken as string]) {
                expect(stored).not.toContain(value);
            }
        });
    });

    describe('logout', () => {
        it('deletes the session so a subsequent request with the same cookie is rejected', async () => {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const { cookieHeader, body } = await login();

            // the cookies say which login ends, since a browser cannot read them to put them in a body
            const res: Response = await fetch(`${baseUrl}/auth/logout`, {
                method: 'POST',
                headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ clearCookies: true })
            });
            expect(res.status).toBe(200);
            // a password login was started at no provider to log out at as well
            expect(await res.json()).toEqual({});

            const meRes: Response = await fetch(`${baseUrl}/cookie-test/me`, { headers: { Cookie: cookieHeader } });
            expect(meRes.status).toBe(401);

            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(await sessionRepo.findAll({ where: { userId: body.userId as string } })).toHaveLength(0);
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(await refreshSessionRepo.findAll({ where: { userId: body.userId as string } })).toHaveLength(0);
        });

        it('ends only the login whose cookies it carries, whichever refresh session the body names', async () => {
            const own: LoginResult = await login();
            const ownIds: string[] = (await refreshSessionRepo.findAll({})).map(refreshSession => refreshSession.id);
            const other: LoginResult = await login();
            const [otherRefreshSession] = await refreshSessionRepo.findAll({ where: { id: { notOneOf: ownIds } } });
            assert(otherRefreshSession);

            await fetch(`${baseUrl}/auth/logout`, {
                method: 'POST',
                headers: { Cookie: own.cookieHeader, 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ clearCookies: true, refreshSessionId: otherRefreshSession.id })
            });

            const otherMe: Response = await fetch(`${baseUrl}/cookie-test/me`, { headers: { Cookie: other.cookieHeader } });
            expect(otherMe.status).toBe(200);
        });
    });

    describe('password reset', () => {
        it('creates a token on request, accepts it on verify, and changing the password invalidates the old one', async () => {
            const requestRes: Response = await fetch(`${baseUrl}/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email })
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
                body: JsonUtilities.stringify({ resetToken })
            });
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript-js/typedef
            const verifyBody = await verifyRes.json();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(verifyBody.isValid).toBe(true);

            const confirmRes: Response = await fetch(`${baseUrl}/auth/confirm-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ resetToken, newPassword: 'newPass456' })
            });
            expect(confirmRes.status).toBe(204);

            const oldLoginRes: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email, password })
            });
            expect(oldLoginRes.status).toBe(401);

            const newLoginRes: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email, password: 'newPass456' })
            });
            expect(newLoginRes.status).toBe(200);
        });

        it('ends every login of the user, so a refresh session cannot start a new one', async () => {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const { cookieHeader, body } = await login();
            await fetch(`${baseUrl}/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email })
            });
            const confirmRes: Response = await fetch(`${baseUrl}/auth/confirm-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ resetToken: await resetTokenFromEmail(), newPassword: 'newPass456' })
            });
            expect(confirmRes.status).toBe(204);

            // whoever held the cookies before the reset - the reason for a reset, more often than not
            const refreshRes: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                // eslint-disable-next-line typescript/no-unsafe-member-access
                headers: { Cookie: cookieHeader, 'Content-Type': 'application/json', 'x-csrf-token': body.csrfToken as string },
                body: '{}'
            });
            expect(refreshRes.status).toBe(401);
            expect(await refreshSessionRepo.findAll({})).toHaveLength(0);
        });

        it('refuses a new password longer than the cap, and leaves the old one working', async () => {
            await fetch(`${baseUrl}/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email })
            });
            const resetToken: string = await resetTokenFromEmail();

            const confirmRes: Response = await fetch(`${baseUrl}/auth/confirm-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ resetToken, newPassword: 'a'.repeat(PASSWORD_MAX_LENGTH + 1) })
            });
            expect(confirmRes.status).toBe(400);

            const { res } = await login();
            expect(res.status).toBe(200);
        });

        it('ignores a second request while a reset token is already active', async () => {
            const firstRes: Response = await fetch(`${baseUrl}/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email })
            });
            expect(firstRes.status).toBe(204);

            const secondRes: Response = await fetch(`${baseUrl}/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email })
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
                body: JsonUtilities.stringify({ resetToken: 'not-a-real-token' })
            });
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript-js/typedef
            const body = await res.json();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(body.isValid).toBe(false);
        });

        it('confirm-password-reset rejects an unknown token', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/confirm-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ resetToken: 'not-a-real-token', newPassword: 'whatever123' })
            });
            expect(res.status).toBe(401);
        });
    });
});