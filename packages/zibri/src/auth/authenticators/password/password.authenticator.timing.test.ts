import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { PasswordCredentials, PasswordCredentialsCreateData } from './password-credentials.model';
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
import { JsonUtilities } from '../../../utilities/json.utilities';
import { ScryptCost } from '../../hash/strategies/scrypt.hash-strategy';

/**
 * How long a login with a wrong password takes, the quickest of a few.
 * @param baseUrl - Where the server is reachable.
 * @param email - The address to log in with.
 * @returns The duration in milliseconds.
 */
async function resolveLoginDurationInMs(baseUrl: string, email: string): Promise<number> {
    const durations: number[] = [];
    for (let attempt: number = 0; attempt < 3; attempt++) {
        const started: number = performance.now();
        const res: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({ email, password: 'wrong-password' })
        });
        expect(res.status).toBe(401);
        durations.push(performance.now() - started);
    }
    return Math.min(...durations);
}

// a hash keeps the cost it was made at, so after the cost is raised a user who has not logged in
// since holds a cheaper hash than the one an unknown address is compared against
describe('PasswordAuthenticator — the time a refused login takes', () => {
    const cost: ScryptCost = { n: 2 ** 10, r: 8, p: 1 };
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
            controllers: [JwtTestAuthController],
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.SCRYPT_COST, useValue: cost })]
        });
        baseUrl = await server.start();

        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: 'dormant@example.com', roles: [Roles.USER] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ password: 'secure123', userId: user.id });
        cost.n = 2 ** 16;
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('takes as long for a user whose hash costs less than for an address nobody has', async () => {
        const unknown: number = await resolveLoginDurationInMs(baseUrl, 'nobody@example.com');
        const dormant: number = await resolveLoginDurationInMs(baseUrl, 'dormant@example.com');

        expect(dormant).toBeGreaterThan(unknown * 0.7);
    }, TestTimeouts.inMemory.start);
});