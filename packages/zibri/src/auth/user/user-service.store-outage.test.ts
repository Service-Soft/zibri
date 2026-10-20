import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { UserRepositoryInterface } from './user-repository.interface.ts';
import { JwtTestAuthController } from '../../__testing__/mocks/controllers/jwt-test-auth.controller.ts';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model.ts';
import { Log } from '../../logging/log.model.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { PasswordCredentials } from '../authenticators/password/password-credentials.model.ts';
import { UserRepo } from '../decorators/user-repo.decorator.ts';

/**
 * What a login does while one of the places users are kept cannot be reached.
 *
 * An application with a directory next to its own table, for example, holds users in two places.
 * The directory being down is not the same thing as the address being unknown, and the trail is
 * where the difference has to survive: a run of refused logins reads as somebody guessing, a run of
 * failed ones as an outage.
 */

/**
 * A user store that cannot be reached, next to the test server's own one.
 */
@UserRepo()
class UnreachableUserRepository implements UserRepositoryInterface<Roles, JwtUser> {
    async findById(): Promise<JwtUser> {
        return await Promise.reject(new Error('connect ECONNREFUSED - the user directory is unreachable'));
    }

    async findByEmail(): Promise<JwtUser> {
        return await Promise.reject(new Error('connect ECONNREFUSED - the user directory is unreachable'));
    }

    async updateDeactivatedAt(): Promise<void> {
        await Promise.reject(new Error('connect ECONNREFUSED - the user directory is unreachable'));
    }
}
// the class exists to be registered by @UserRepo, which happens when it is declared
void UnreachableUserRepository;

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

describe('logging in while a user store is down', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let logRepository: Repository<Log>;

    const email: string = 'held-by-the-working-store@example.com';
    const password: string = 'secure123';

    /**
     * Logs in over http.
     * @param address - The address to log in as.
     * @returns The response.
     */
    async function login(address: string): Promise<Response> {
        return await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JsonUtilities.stringify({ email: address, password })
        });
    }

    /**
     * The audit blocks of everything logged so far, flushed first because the logger writes later.
     * @returns Whatever each entry carries under `context.metadata.audit`.
     */
    async function auditEvents(): Promise<unknown[]> {
        await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
        return (await logRepository.findAll({})).map(l => l.context.metadata?.['audit']);
    }

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            controllers: [JwtTestAuthController],
            providers: defaultTestServerProviders
        });
        baseUrl = await server.start();
        logRepository = inject(repositoryTokenFor(Log));

        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
        await inject(repositoryTokenFor(PasswordCredentials)).create({ password, userId: user.id });
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('still logs in a user the reachable store holds', async () => {
        // one store being down must not lock out the users of another
        expect((await login(email)).status).toBe(200);
    });

    it('records a login it could not decide as an error rather than as a refusal', async () => {
        const address: string = 'maybe-in-the-directory@example.com';

        const res: Response = await login(address);

        // nobody can say whether this address exists or whether the password is right, because the
        // one store that might hold it did not answer. Answering 401 says the credentials were wrong,
        // and the users service used to turn every failed lookup into "not found" - so an outage
        // was refused like a wrong password, to the caller and in the trail.
        expect(res.status).toBe(500);
        expect(await auditEvents()).toContainEqual({
            action: AuditAction.LOGIN,
            outcome: AuditOutcome.FAILURE,
            reason: AuditReason.ERROR,
            subject: address
        });
    });
});