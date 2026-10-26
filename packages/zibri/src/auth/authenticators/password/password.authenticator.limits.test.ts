import { setTimeout as wait } from 'node:timers/promises';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { PasswordCredentials, PasswordCredentialsCreateData } from './password-credentials.model';
import { PasswordFailureStreak } from './password-failure-streak.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { JwtTestAuthController } from '../../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { AuditAction, AuditEvent, AuditOutcome, AuditReason } from '../../../logging/audit-event.model';
import { Log } from '../../../logging/log.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { RateLimitStoreFailurePolicy } from '../../../rate-limiting/limiter/rate-limiter-config.model';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { Ms } from '../../../utilities/ms';
import { PasswordResetToken, PasswordResetTokenCreateData } from '../../models/password-reset-token.model';
import { JwtAuthStrategy } from '../../strategies/jwt/jwt.auth-strategy';

const PASSWORD: string = 'correct horse battery staple';
const WRONG_PASSWORD: string = 'incorrect horse battery staple';
const MAX_ATTEMPTS: number = 10;
const MAX_FAILURES: number = 3;
const LOCK_FOR_MS: number = 1500;

let server: StartedTestServer;
let baseUrl: string;

/**
 * Creates a user who logs in with a password.
 * @param name - What sets the user's email apart.
 * @returns The user.
 */
async function createUser(name: string): Promise<JwtUser> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: `${name}@limits.test`, roles: [Roles.USER] });
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    await credentials.create({ userId: user.id, password: PASSWORD });
    return user;
}

/**
 * One login attempt over http.
 * @param user - Whose account.
 * @param password - What is presented.
 * @param from - The address it comes from.
 * @returns The status.
 */
async function loginAs(user: JwtUser, password: string, from: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': from },
        body: JsonUtilities.stringify({ email: user.email, password })
    });
    return res.status;
}

/**
 * What the trail recorded under the given action.
 * @param action - The action.
 * @returns The events, oldest first.
 */
async function eventsOf(action: AuditAction): Promise<AuditEvent[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return (await inject(repositoryTokenFor(Log)).findAll({}))
        .map(l => l.context.metadata?.['audit'] as AuditEvent | undefined)
        .filter((event): event is AuditEvent => event?.action === action);
}

describe('PasswordAuthenticator - what bounds the guessing', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, PasswordFailureStreak], repositories: defaultTestServerRepositories })],
            authStrategies: [JwtAuthStrategy],
            controllers: [JwtTestAuthController],
            passwordFailureLimit: { maxFailures: MAX_FAILURES, lockForInMs: LOCK_FOR_MS },
            providers: [
                ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.AUTH_RATE_LIMIT_OPTIONS),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.AUTH_RATE_LIMIT_OPTIONS,
                    useFactory: () => ({ maxAttempts: MAX_ATTEMPTS, windowInMs: Ms.MINUTE * 10, onStoreFailure: RateLimitStoreFailurePolicy.ALLOW })
                })
            ],
            // each case is its own caller, which is the only way one budget per case can be told apart
            security: { trustProxy: true }
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    afterEach(async () => {
        await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
        await inject(repositoryTokenFor(Log)).deleteAll({});
    });

    it('does not spend the caller\'s budget on a login that succeeds', async () => {
        const user: JwtUser = await createUser('office');

        for (let i: number = 0; i <= MAX_ATTEMPTS; i++) {
            expect(await loginAs(user, PASSWORD, '203.0.113.1')).toBe(200);
        }
    });

    it('spends it on a login that fails, whichever account it was for', async () => {
        const first: JwtUser = await createUser('spray-a');
        const second: JwtUser = await createUser('spray-b');

        for (let i: number = 0; i < MAX_ATTEMPTS; i++) {
            expect(await loginAs(i % 2 === 0 ? first : second, WRONG_PASSWORD, '203.0.113.2')).toBe(401);
        }
        expect(await loginAs(first, PASSWORD, '203.0.113.2')).toBe(429);
    });

    it('locks an account after too many wrong passwords in a row, and refuses the right one like a wrong one until the lock passes', async () => {
        const user: JwtUser = await createUser('locked');

        for (let i: number = 0; i < MAX_FAILURES; i++) {
            expect(await loginAs(user, WRONG_PASSWORD, '203.0.113.3')).toBe(401);
        }
        expect(await loginAs(user, PASSWORD, '203.0.113.3')).toBe(401);

        const locked: AuditEvent = { action: AuditAction.PASSWORD_LOCKED, outcome: AuditOutcome.SUCCESS, userId: user.id };
        expect(await eventsOf(AuditAction.PASSWORD_LOCKED)).toEqual([locked]);
        const refusals: AuditEvent[] = await eventsOf(AuditAction.LOGIN);
        expect(refusals.at(-1)).toEqual({
            action: AuditAction.LOGIN,
            outcome: AuditOutcome.FAILURE,
            reason: AuditReason.LOCKED,
            subject: user.email
        });

        await wait(LOCK_FOR_MS + 100);
        expect(await loginAs(user, PASSWORD, '203.0.113.3')).toBe(200);
    }, 15000);

    it('ends the streak with a correct password', async () => {
        const user: JwtUser = await createUser('fumbling');

        for (let round: number = 0; round < 2; round++) {
            for (let i: number = 0; i < MAX_FAILURES - 1; i++) {
                expect(await loginAs(user, WRONG_PASSWORD, '203.0.113.4')).toBe(401);
            }
            expect(await loginAs(user, PASSWORD, '203.0.113.4')).toBe(200);
        }
        expect(await eventsOf(AuditAction.PASSWORD_LOCKED)).toEqual([]);
    });

    it('lifts the lock with a confirmed password reset', async () => {
        const user: JwtUser = await createUser('resetting');
        for (let i: number = 0; i < MAX_FAILURES; i++) {
            await loginAs(user, WRONG_PASSWORD, '203.0.113.5');
        }
        expect(await loginAs(user, PASSWORD, '203.0.113.5')).toBe(401);

        const resetToken: string = 'the-link-in-the-mail';
        const tokens: Repository<PasswordResetToken, PasswordResetTokenCreateData> = inject(repositoryTokenFor(PasswordResetToken));
        await tokens.create({ value: resetToken, userId: user.id, expirationDate: new Date(Date.now() + Ms.HOUR) });
        const newPassword: string = 'a new horse battery staple';
        const res: Response = await fetch(`${baseUrl}/auth/confirm-password-reset`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.5' },
            body: JsonUtilities.stringify({ resetToken, newPassword })
        });
        expect(res.status).toBeLessThan(300);

        expect(await loginAs(user, newPassword, '203.0.113.5')).toBe(200);
    });
});