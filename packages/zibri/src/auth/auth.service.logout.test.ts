import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { PasswordCredentials, PasswordCredentialsCreateData } from './authenticators/password/password-credentials.model';
import { JwtRefreshToken } from './strategies/jwt/jwt-refresh-token.model';
import { JwtAuthStrategy } from './strategies/jwt/jwt.auth-strategy';
import { JwtTestAuthController } from '../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { AuditAction, AuditEvent, AuditOutcome, AuditReason } from '../logging/audit-event.model';
import { Log } from '../logging/log.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { Newable } from '../types/newable.type';
import { JsonUtilities } from '../utilities/json.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * What the trail records about a logout.
 *
 * A logout answers 200 whatever happened, since a client that could not log out has nothing to do
 * with the failure. The trail is the one place the difference survives, so it has to say whose
 * login ended, and that one did not.
 */

const PASSWORD: string = 'correct horse battery staple';

let server: StartedTestServer;
let baseUrl: string;

/**
 * Creates a user who logs in with a password.
 * @param name - What sets the user's email apart.
 * @returns The user.
 */
async function createUser(name: string): Promise<JwtUser> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: `${name}@logout.test`, roles: [Roles.USER] });
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    await credentials.create({ userId: user.id, password: PASSWORD });
    return user;
}

/**
 * Logs a user in over http.
 * @param user - The user.
 * @returns The refresh token.
 */
async function loginRefreshToken(user: JwtUser): Promise<string> {
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email: user.email, password: PASSWORD })
    });
    expect(res.status).toBe(200);
    // eslint-disable-next-line typescript/no-unsafe-assignment
    const body: { refreshToken: { value: string } } = await res.json();
    return body.refreshToken.value;
}

/**
 * Logs out over http with a refresh token.
 * @param refreshToken - The refresh token.
 * @returns The status.
 */
async function logout(refreshToken: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ refreshToken })
    });
    return res.status;
}

/**
 * What the trail recorded about logouts.
 * @returns The events, oldest first.
 */
async function logoutEvents(): Promise<AuditEvent[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return (await inject(repositoryTokenFor(Log)).findAll({}))
        .map(l => l.context.metadata?.['audit'] as AuditEvent | undefined)
        .filter((event): event is AuditEvent => event?.action === AuditAction.LOGOUT);
}

describe('AuthService - what a logout records', () => {
    beforeAll(async () => {
        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories });
        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy],
            controllers: [JwtTestAuthController],
            providers: defaultTestServerProviders
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    /**
     * Empties the trail, once everything queued for it is written.
     */
    async function clearTrail(): Promise<void> {
        await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
        await inject(repositoryTokenFor(Log)).deleteAll({});
    }

    afterEach(async () => {
        jest.restoreAllMocks();
        await clearTrail();
    });

    it('records whose login ended', async () => {
        const user: JwtUser = await createUser('ending');
        const refreshToken: string = await loginRefreshToken(user);

        expect(await logout(refreshToken)).toBe(200);

        expect(await logoutEvents()).toEqual([{ action: AuditAction.LOGOUT, outcome: AuditOutcome.SUCCESS, userId: user.id }]);
    });

    it('records a refusal for a credential that names no login, and still answers 200', async () => {
        const user: JwtUser = await createUser('spent');
        const refreshToken: string = await loginRefreshToken(user);
        await logout(refreshToken);
        await clearTrail();

        // once spent, and once never issued: both are a logout without a login
        expect(await logout(refreshToken)).toBe(200);
        expect(await logout(UUIDUtilities.generate())).toBe(200);

        expect(await logoutEvents()).toEqual([
            { action: AuditAction.LOGOUT, outcome: AuditOutcome.FAILURE, reason: AuditReason.REFUSED },
            { action: AuditAction.LOGOUT, outcome: AuditOutcome.FAILURE, reason: AuditReason.REFUSED }
        ]);
    });

    it('records an error for a login the store could not end, which is still live', async () => {
        const user: JwtUser = await createUser('stuck');
        const refreshToken: string = await loginRefreshToken(user);
        jest.spyOn(inject<Repository<JwtRefreshToken>>(repositoryTokenFor(JwtRefreshToken)), 'deleteAll')
            .mockRejectedValueOnce(new Error('the store is down'));

        expect(await logout(refreshToken)).toBe(200);

        expect(await logoutEvents()).toEqual([{ action: AuditAction.LOGOUT, outcome: AuditOutcome.FAILURE, reason: AuditReason.ERROR }]);
        // the credential still works, which is what the record is for
        expect(await logout(refreshToken)).toBe(200);
        expect(await logoutEvents()).toContainEqual({ action: AuditAction.LOGOUT, outcome: AuditOutcome.SUCCESS, userId: user.id });
    });
});