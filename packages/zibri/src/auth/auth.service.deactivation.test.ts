import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { type AuthServiceInterface } from './auth-service.interface.ts';
import { PasswordCredentials, PasswordCredentialsCreateData } from './authenticators/password/password-credentials.model.ts';
import { Auth } from './decorators/auth.decorator.ts';
import { CurrentUser } from './decorators/current-user.decorator.ts';
import { ApiKeyAuthStrategy } from './strategies/api-key/api-key.auth-strategy.ts';
import { ApiKey } from './strategies/api-key/api-key.model.ts';
import { CreatedApiKey } from './strategies/api-key/created-api-key.model.ts';
import { JwtAuthStrategy } from './strategies/jwt/jwt.auth-strategy.ts';
import { JwtTestAuthController } from '../__testing__/mocks/controllers/jwt-test-auth.controller.ts';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { AuditAction, AuditOutcome, AuditReason } from '../logging/audit-event.model.ts';
import { Log } from '../logging/log.model.ts';
import { type LoggerInterface } from '../logging/logger.interface.ts';
import { Controller } from '../routing/decorators/controller.decorator.ts';
import { Get } from '../routing/decorators/get.decorator.ts';
import { Newable } from '../types/newable.type.ts';
import { JsonUtilities } from '../utilities/json.utilities.ts';

/**
 * What the login route answers.
 */
type Tokens = {
    accessToken: { value: string },
    refreshToken: { value: string }
};

const PASSWORD: string = 'correct horse battery staple';

@Controller('/deactivation')
class MeController {
    @Auth.isLoggedIn()
    @Get('/me')
    me(
        @CurrentUser()
        user: JwtUser
    ): { id: string } {
        return { id: user.id };
    }
}

let server: StartedTestServer;
let baseUrl: string;

/**
 * The auth service of the running application.
 * @returns The service.
 */
function authService(): AuthServiceInterface {
    return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
}

/**
 * Creates a user who logs in with a password.
 * @param name - What sets the user's email apart.
 * @returns The user.
 */
async function createUser(name: string): Promise<JwtUser> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: `${name}@deactivation.test`, roles: [Roles.USER] });
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    await credentials.create({ userId: user.id, password: PASSWORD });
    return user;
}

/**
 * Logs a user in over http.
 * @param user - The user.
 * @returns The answer.
 */
async function login(user: JwtUser): Promise<Response> {
    return await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email: user.email, password: PASSWORD })
    });
}

/**
 * Logs a user in over http, expecting it to work.
 * @param user - The user.
 * @returns The tokens.
 */
async function loginTokens(user: JwtUser): Promise<Tokens> {
    const res: Response = await login(user);
    expect(res.status).toBe(200);
    // eslint-disable-next-line typescript/no-unsafe-return
    return await res.json();
}

/**
 * Calls the route answering with the current user.
 * @param headers - The credential to send.
 * @returns The status.
 */
async function me(headers: Record<string, string>): Promise<number> {
    return (await fetch(`${baseUrl}/deactivation/me`, { headers })).status;
}

/**
 * What the audit trail recorded.
 * @returns Whatever each entry carries under `context.metadata.audit`.
 */
async function auditEvents(): Promise<unknown[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return (await inject(repositoryTokenFor(Log)).findAll({})).map(l => l.context.metadata?.['audit']);
}

describe('AuthService — deactivating a user', () => {
    beforeAll(async () => {
        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
            entities: [...defaultTestServerEntities, ApiKey],
            allowOrphan: true
        });
        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
            controllers: [JwtTestAuthController, MeController],
            providers: defaultTestServerProviders
        });
        baseUrl = await server.start();
    });

    afterAll(async () => {
        await server.shutdown();
    });

    it('refuses their access token, their refresh token and their next login', async () => {
        const user: JwtUser = await createUser('anna');
        const tokens: Tokens = await loginTokens(user);
        expect(await me({ authorization: `Bearer ${tokens.accessToken.value}` })).toBe(200);

        await authService().deactivateUser(user.id, undefined);

        expect(await me({ authorization: `Bearer ${tokens.accessToken.value}` })).toBe(401);
        const refreshed: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JsonUtilities.stringify({ refreshToken: tokens.refreshToken.value })
        });
        expect(refreshed.status).toBe(401);
        const refused: Response = await login(user);
        expect(refused.status).toBe(403);
        expect(await refused.json()).toMatchObject({ name: 'AccountDeactivatedError' });
    });

    it('revokes their api keys for good', async () => {
        const user: JwtUser = await createUser('bob');
        const { key }: CreatedApiKey = await authService().createApiKey(
            user.id,
            { name: 'ci', roles: [Roles.USER], expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
            undefined
        );
        expect(await me({ 'x-api-key': key })).toBe(200);

        await authService().deactivateUser(user.id, undefined);
        expect(await me({ 'x-api-key': key })).toBe(401);
        await authService().reactivateUser(user.id, undefined);

        expect(await me({ 'x-api-key': key })).toBe(401);
        expect(await authService().findApiKeys(user.id, undefined)).toEqual([]);
    });

    it('lets them log in again once reactivated', async () => {
        const user: JwtUser = await createUser('carla');
        await authService().deactivateUser(user.id, undefined);

        await authService().reactivateUser(user.id, undefined);

        const tokens: Tokens = await loginTokens(user);
        expect(await me({ authorization: `Bearer ${tokens.accessToken.value}` })).toBe(200);
    });

    it('refuses to deactivate a user nobody holds', async () => {
        await expect(authService().deactivateUser('8a0f7c1e-3b9d-4e2a-9c61-0d5f3e7b2a14', undefined)).rejects.toThrow('Could not find user');
    });

    it('records deactivating, reactivating and the refused login', async () => {
        const user: JwtUser = await createUser('dave');
        await authService().deactivateUser(user.id, undefined);
        expect((await login(user)).status).toBe(403);
        await authService().reactivateUser(user.id, undefined);

        const events: unknown[] = await auditEvents();

        expect(events).toContainEqual({ action: AuditAction.USER_DEACTIVATED, outcome: AuditOutcome.SUCCESS, userId: user.id });
        expect(events).toContainEqual({ action: AuditAction.USER_REACTIVATED, outcome: AuditOutcome.SUCCESS, userId: user.id });
        expect(events).toContainEqual({
            action: AuditAction.LOGIN,
            outcome: AuditOutcome.FAILURE,
            reason: AuditReason.DEACTIVATED,
            subject: user.email
        });
    });
});