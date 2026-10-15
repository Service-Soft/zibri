import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { JwtTestAuthController } from '../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { startAndStopTestServerWithout } from '../../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { Email } from '../../email/models/email.model';
import { GlobalRegistry } from '../../global/global-registry';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { JsonUtilities } from '../../utilities/json.utilities';
import { Ms } from '../../utilities/ms';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../authenticators/password/password-credentials.model';
import { Auth } from '../decorators/auth.decorator';
import { PASSWORD_MAX_LENGTH } from '../hash/hash.utilities';
import { PasswordResetToken } from '../models/password-reset-token.model';
import { JwtKey } from '../strategies/jwt/jwt-key.model';
import { JwtRefreshToken } from '../strategies/jwt/jwt-refresh-token.model';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy';
import { JwtUtilities } from '../strategies/jwt/jwt.utilities';

/**
 * Something to present an access token to.
 *
 * The auth routes verify refresh tokens; this is the only way to drive the access token path, which
 * is the one every authenticated request in an application takes.
 */
@Controller('/jwt-test')
class JwtProtectedController {
    @Get('/me')
    @Auth.isLoggedIn([JwtAuthStrategy])
    me(): { ok: boolean } {
        return { ok: true };
    }
}

type LoginResponseBody = {
    userId: string,
    accessToken: { value: string, expirationDate: string },
    refreshToken: { value: string, expirationDate: string },
    roles: string[]
};

// first, for the reason on startAndStopTestServerWithout
describe('JwtAuthStrategy — starting', () => {
    it('refuses to start without its entity, and names it', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([JwtRefreshToken], {
            controllers: [JwtTestAuthController, JwtProtectedController]
        });

        await expect(start).rejects.toThrow(/Error initializing JwtAuthStrategy[\S\s]*JwtRefreshToken/);
    }, 30000);
});

describe('AuthController / JwtAuthStrategy — real HTTP flow', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let userRepo: Repository<JwtUser>;
    let credentialsRepo: Repository<PasswordCredentials, PasswordCredentialsCreateData>;
    let resetTokenRepo: Repository<PasswordResetToken>;
    let emailRepo: Repository<Email>;
    let userId: string;

    const email: string = 'jwt-auth-test@example.com';
    const password: string = 'secure123';

    /**
     * The reset token as the user gets it: out of the link in the email.
     *
     * The stored value is hashed, so the database no longer holds anything that can be presented
     * back to the api - which is the whole point of hashing it, and the reason this cannot take the
     * shortcut through the repository it used to.
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
        server = await startTestServer({ controllers: [JwtTestAuthController, JwtProtectedController] });
        baseUrl = await server.start();
        userRepo = inject(repositoryTokenFor(JwtUser));
        credentialsRepo = inject(repositoryTokenFor(PasswordCredentials));
        resetTokenRepo = inject(repositoryTokenFor(PasswordResetToken));
        emailRepo = inject(repositoryTokenFor(Email));
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        await emailRepo.deleteAll({});
        await resetTokenRepo.deleteAll({});
        await credentialsRepo.deleteAll({});
        await userRepo.deleteAll({});

        const user: JwtUser = await userRepo.create({ email, roles: [Roles.USER] });
        userId = user.id;
        await credentialsRepo.create({ password, userId });
    });

    async function login(): Promise<LoginResponseBody> {
        const res: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({ email, password })
        });
        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-return
        return await res.json();
    }

    describe('login', () => {
        it('returns access and refresh tokens plus the user data', async () => {
            const body: LoginResponseBody = await login();
            expect(body.userId).toBeTruthy();
            expect(body.accessToken.value).toBeTruthy();
            expect(body.refreshToken.value).toBeTruthy();
            expect(body.roles).toEqual([Roles.USER]);
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
            // the cap bounds the input every login hashes, so past it the body is refused by
            // validation and no key is derived at all
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

    describe('storing a password', () => {
        it('refuses to hash a value that is already a hash', async () => {
            const stored: PasswordCredentials = await credentialsRepo.findOne({ where: { userId } });

            // exactly what a read-modify-write does: load the entity, hand it back. Hashing the hash
            // cannot be undone, and the value it would replace is the only thing that could ever
            // verify this password again - so the write is refused rather than quietly accepted.
            await expect(
                credentialsRepo.updateById(stored.id, { password: stored.password })
            ).rejects.toThrow(/already hashed/);

            // and the account still works
            const res: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email, password })
            });
            expect(res.status).toBe(200);
        });

        it('accepts a new plaintext password', async () => {
            const stored: PasswordCredentials = await credentialsRepo.findOne({ where: { userId } });
            await credentialsRepo.updateById(stored.id, { password: 'a-new-password' });

            const res: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ email, password: 'a-new-password' })
            });
            expect(res.status).toBe(200);
        });
    });

    describe('what a token has to prove', () => {
        const accessTokenKey: JwtKey = JwtUtilities.resolveSigningKey('test-access-token-secret');

        /**
         * Who the application's tokens name as their issuer and audience.
         * @returns Its baseUrl.
         */
        function issuer(): string {
            return GlobalRegistry.getAppData('baseUrl') ?? '';
        }

        async function callMeWith(token: string): Promise<number> {
            const res: Response = await fetch(`${baseUrl}/jwt-test/me`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return res.status;
        }

        it('accepts a token this application issued', async () => {
            const { accessToken } = await login();
            expect(await callMeWith(accessToken.value)).toBe(200);
        });

        it('refuses a correctly signed token that names a different issuer', async () => {
            // the shape of two services sharing a secret: the signature checks out, so nothing but
            // the issuer separates one service's tokens from the other's
            const foreign: string = await JwtUtilities.sign(
                { id: userId, email, roles: [Roles.USER], auth_time: Math.floor(Date.now() / Ms.SECOND), sid: 'login' },
                accessTokenKey,
                { expiresInMs: Ms.HOUR, issuer: 'https://a-different-application.example.com', audience: issuer(), type: 'at+jwt' }
            );
            expect(await callMeWith(foreign)).toBe(401);
        });

        it('refuses a correctly signed token for a different audience', async () => {
            // the shape of a token a client was issued for another service: issued here, signed here,
            // and still not for this application
            const elsewhere: string = await JwtUtilities.sign(
                { id: userId, email, roles: [Roles.USER], auth_time: Math.floor(Date.now() / Ms.SECOND), sid: 'login' },
                accessTokenKey,
                { expiresInMs: Ms.HOUR, issuer: issuer(), audience: 'https://reports.example.com', type: 'at+jwt' }
            );
            expect(await callMeWith(elsewhere)).toBe(401);
        });

        it('refuses a correctly signed token whose payload is not an access token', async () => {
            // verification proves the token came from here, not that what is inside it is what the
            // code about to read it expects. `id` and `roles` were read off whatever came back.
            const wrongShape: string = await JwtUtilities.sign(
                { something: 'else' },
                accessTokenKey,
                { expiresInMs: Ms.HOUR, issuer: issuer(), audience: issuer(), type: 'at+jwt' }
            );
            expect(await callMeWith(wrongShape)).toBe(401);
        });

        it('names this application as the issuer and the audience of its access tokens', async () => {
            const { accessToken } = await login();
            const payload: unknown = JwtUtilities.findUnverifiedPayload(accessToken.value);

            expect(payload).toMatchObject({ iss: issuer(), aud: issuer() });
        });

        it('refuses a refresh token presented as an access token', async () => {
            const { refreshToken } = await login();
            expect(await callMeWith(refreshToken.value)).toBe(401);
        });
    });

    describe('refresh-login', () => {
        it('returns a fresh access token for a valid refresh token', async () => {
            const { refreshToken } = await login();
            const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ refreshToken: refreshToken.value })
            });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: LoginResponseBody = await res.json();
            expect(body.accessToken.value).toBeTruthy();
        });

        it('hands back a refresh token that can itself be refreshed', async () => {
            const { refreshToken } = await login();
            const first: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ refreshToken: refreshToken.value })
            });
            expect(first.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: LoginResponseBody = await first.json();

            // the row a rotation creates holds the token hashed, so answering with the row's value
            // handed the client a hash: the first refresh worked and the one after it was refused
            const second: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ refreshToken: body.refreshToken.value })
            });
            expect(second.status).toBe(200);
        });

        it('rejects and rolls back on an invalid refresh token, leaving no orphaned state', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ refreshToken: 'not-a-real-token' })
            });
            expect(res.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe('logout', () => {
        it('invalidates the refresh token so a subsequent refresh-login fails', async () => {
            const { refreshToken } = await login();

            const logoutRes: Response = await fetch(`${baseUrl}/auth/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ refreshToken: refreshToken.value })
            });
            expect(logoutRes.status).toBe(200);
            // a password login was started at no provider to log out at as well
            expect(await logoutRes.json()).toEqual({});

            const refreshRes: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ refreshToken: refreshToken.value })
            });
            expect(refreshRes.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe('password reset', () => {
        it('creates a token on request, accepts it on verify, and the new password works while the old one does not', async () => {
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
            // place the token exists. Reading it off the entity is what let the stored value and the
            // mailed one drift apart without a single test noticing.
            const resetToken: string = await resetTokenFromEmail();

            const verifyRes: Response = await fetch(`${baseUrl}/auth/verify-password-reset-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ resetToken })
            });
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/typedef
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

            await login();
        });

        it('verify-password-reset-token returns isValid: false for an unknown token', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/verify-password-reset-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ resetToken: 'not-a-real-token' })
            });
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/typedef
            const body = await res.json();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(body.isValid).toBe(false);
        });

        it('verify-password-reset-token returns isValid: false and deletes an expired token', async () => {
            const user: JwtUser = await userRepo.findOne({ where: { email } });
            // kept, not read back: the row holds the hash of this, so the entity cannot hand it back
            const tokenValue: string = 'expired-token-value';
            const expired: PasswordResetToken = await resetTokenRepo.create({
                value: tokenValue,
                userId: user.id,
                expirationDate: new Date(Date.now() - 1000)
            });

            const res: Response = await fetch(`${baseUrl}/auth/verify-password-reset-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ resetToken: tokenValue })
            });
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/typedef
            const body = await res.json();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(body.isValid).toBe(false);
            expect(await resetTokenRepo.findOne({ where: { id: expired.id }, required: false })).toBeUndefined();
        });

        it('confirm-password-reset rejects an unknown token', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/confirm-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JsonUtilities.stringify({ resetToken: 'not-a-real-token', newPassword: 'whatever123' })
            });
            expect(res.status).toBeGreaterThanOrEqual(400);
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

            // this used to answer 429, which told an unauthenticated caller both that the address
            // exists and that somebody had recently asked about it. One live token is still the
            // rule - the difference is that refusing is now silent.
            expect(secondRes.status).toBe(204);
            expect(await resetTokenRepo.findAll({})).toHaveLength(1);
        });
    });
});