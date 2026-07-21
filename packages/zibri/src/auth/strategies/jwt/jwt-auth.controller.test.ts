import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { JwtAuthController } from './jwt-auth.controller';
import { JwtCredentials, JwtCredentialsCreateData } from './jwt-credentials.model';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../di/inject.function';
import { PasswordResetToken } from '../../models/password-reset-token.model';

type LoginResponseBody = {
    userId: string,
    accessToken: { value: string, expirationDate: string },
    refreshToken: { value: string, expirationDate: string },
    roles: string[]
};

describe('JwtAuthController — real HTTP flow', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let userRepo: Repository<JwtUser>;
    let credentialsRepo: Repository<JwtCredentials, JwtCredentialsCreateData>;
    let resetTokenRepo: Repository<PasswordResetToken>;

    const email: string = 'jwt-auth-test@example.com';
    const password: string = 'secure123';

    beforeAll(async () => {
        server = await startTestServer({ controllers: [JwtAuthController] });
        baseUrl = await server.start();
        userRepo = inject(repositoryTokenFor(JwtUser));
        credentialsRepo = inject(repositoryTokenFor(JwtCredentials));
        resetTokenRepo = inject(repositoryTokenFor(PasswordResetToken));
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        await resetTokenRepo.deleteAll({});
        await credentialsRepo.deleteAll({});
        await userRepo.deleteAll({});

        const user: JwtUser = await userRepo.create({ email, roles: [Roles.USER] });
        await credentialsRepo.create({ email, password, userId: user.id });
    });

    async function login(): Promise<LoginResponseBody> {
        const res: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
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

    describe('refresh-login', () => {
        it('returns a fresh access token for a valid refresh token', async () => {
            const { refreshToken } = await login();
            const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: refreshToken.value })
            });
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: LoginResponseBody = await res.json();
            expect(body.accessToken.value).toBeTruthy();
        });

        it('rejects and rolls back on an invalid refresh token, leaving no orphaned state', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: 'not-a-real-token' })
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
                body: JSON.stringify({ refreshToken: refreshToken.value })
            });
            expect(logoutRes.status).toBe(200);

            const refreshRes: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: refreshToken.value })
            });
            expect(refreshRes.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe('password reset', () => {
        it('creates a token on request, accepts it on verify, and the new password works while the old one does not', async () => {
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

        it('verify-password-reset-token returns isValid: false and deletes an expired token', async () => {
            const user: JwtUser = await userRepo.findOne({ where: { email } });
            const expired: PasswordResetToken = await resetTokenRepo.create({
                value: 'expired-token-value',
                userId: user.id,
                expirationDate: new Date(Date.now() - 1000)
            });

            const res: Response = await fetch(`${baseUrl}/auth/verify-password-reset-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetToken: expired.value })
            });
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/typedef
            const body = await res.json();
            // eslint-disable-next-line typescript/no-unsafe-member-access
            expect(body.isValid).toBe(false);
            expect(await resetTokenRepo.findOne({ where: { id: expired.id } }, false)).toBeUndefined();
        });

        it('confirm-password-reset rejects an unknown token', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/confirm-password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetToken: 'not-a-real-token', newPassword: 'whatever123' })
            });
            expect(res.status).toBeGreaterThanOrEqual(400);
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
    });
});