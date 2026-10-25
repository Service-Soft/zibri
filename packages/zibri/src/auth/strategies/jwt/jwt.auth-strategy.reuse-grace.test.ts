import { setTimeout as wait } from 'node:timers/promises';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { JwtAuthOptionsInput } from './jwt-auth-options.model';
import { JwtAuthStrategy } from './jwt.auth-strategy';
import { JwtTestAuthController } from '../../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { TestTimeouts } from '../../../__testing__/constants';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { AuditAction, AuditEvent, AuditReason } from '../../../logging/audit-event.model';
import { Log } from '../../../logging/log.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../authenticators/password/password-credentials.model';

const PASSWORD: string = 'correct horse battery staple';
const GRACE_IN_MS: number = 1000;

/**
 * What a login or a refresh answers, as far as these cases read it.
 */
type Tokens = {
    refreshToken: { value: string }
};

let server: StartedTestServer;
let baseUrl: string;

/**
 * Creates a user and logs them in.
 * @param name - What sets the user's email apart.
 * @returns The refresh token of the login.
 */
async function loginAs(name: string): Promise<string> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: `${name}@grace.test`, roles: [Roles.USER] });
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    await credentials.create({ userId: user.id, password: PASSWORD });
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email: user.email, password: PASSWORD })
    });
    expect(res.status).toBe(200);
    return (await res.json() as Tokens).refreshToken.value;
}

/**
 * Presents a refresh token.
 * @param refreshToken - The token.
 * @returns The response.
 */
async function refresh(refreshToken: string): Promise<Response> {
    return await fetch(`${baseUrl}/auth/refresh-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ refreshToken })
    });
}

/**
 * Presents a refresh token and reads the one it is answered with.
 * @param refreshToken - The token.
 * @returns The new token.
 */
async function refreshed(refreshToken: string): Promise<string> {
    const res: Response = await refresh(refreshToken);
    expect(res.status).toBe(200);
    return (await res.json() as Tokens).refreshToken.value;
}

/**
 * The reasons the trail recorded for refused refreshes.
 * @returns The reasons, oldest first.
 */
async function refreshFailureReasons(): Promise<(AuditReason | undefined)[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return (await inject(repositoryTokenFor(Log)).findAll({}))
        .map(l => l.context.metadata?.['audit'] as AuditEvent | undefined)
        .filter((event): event is AuditEvent => event?.action === AuditAction.REFRESH_LOGIN && event.outcome === 'failure')
        .map(event => event.reason);
}

describe('JwtAuthStrategy - a replaced refresh token within the grace', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
            authStrategies: [JwtAuthStrategy],
            controllers: [JwtTestAuthController],
            providers: [
                ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT,
                    useFactory: (): JwtAuthOptionsInput => ({
                        accessTokenKey: 'test-access-token-secret',
                        refreshTokenSecret: 'test-refresh-token-secret',
                        // short, so that a case can wait it out
                        refreshTokenReuseGraceInMs: GRACE_IN_MS
                    })
                })
            ]
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

    it('gives a second tab presenting the replaced token a token of its own, and keeps both', async () => {
        const original: string = await loginAs('two-tabs');
        const firstTab: string = await refreshed(original);

        // the second tab's request, sent with the token both tabs held, arriving after the first one's
        const secondTab: string = await refreshed(original);

        expect(secondTab).not.toBe(firstTab);
        expect((await refresh(firstTab)).status).toBe(200);
        expect((await refresh(secondTab)).status).toBe(200);
        expect(await refreshFailureReasons()).toEqual([]);
    });

    it('ends the login everywhere when the replaced token comes back after the grace', async () => {
        const original: string = await loginAs('stolen');
        const successor: string = await refreshed(original);
        await wait(GRACE_IN_MS + 100);

        expect((await refresh(original)).status).toBe(401);

        expect((await refresh(successor)).status).toBe(401);
        expect(await refreshFailureReasons()).toEqual([AuditReason.TOKEN_REUSED, AuditReason.REFUSED]);
    });

    it('lets a tab holding the replaced token log out, which ends the login everywhere', async () => {
        const original: string = await loginAs('leaving');
        const successor: string = await refreshed(original);

        const res: Response = await fetch(`${baseUrl}/auth/logout`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JsonUtilities.stringify({ refreshToken: original })
        });
        expect(res.status).toBe(200);

        expect((await refresh(successor)).status).toBe(401);
    });
});