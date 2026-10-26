import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { BaseUserRepository } from './base-user-repository.model';
import { TestTimeouts } from '../../__testing__/constants';
import { JwtTestAuthController } from '../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { RepositoryFor } from '../../data-source/repository/repository-for.decorator';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { Entity } from '../../entity/decorators/entity.decorator';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model';
import { Log } from '../../logging/log.model';
import { type LoggerInterface } from '../../logging/logger.interface';
import { JsonUtilities } from '../../utilities/json.utilities';
import { PasswordCredentials } from '../authenticators/password/password-credentials.model';
import { BaseUserEntity } from '../models/base-user.model';

/**
 * What a login does while one of the places users are kept cannot be reached.
 *
 * An application with a directory next to its own table, for example, holds users in two places.
 * The directory being down is not the same thing as the address being unknown, and the trail is
 * where the difference has to survive: a run of refused logins reads as somebody guessing, a run of
 * failed ones as an outage.
 */

/**
 * Users kept in a second place, such as a directory synchronized into a table of its own.
 */
@Entity({ tenant: 'shared' })
class DirectoryUser extends BaseUserEntity<string>() {}

/**
 * The repository of the second place, whose store cannot be reached: every login asks it, next to
 * the test server's own one.
 */
@RepositoryFor(DirectoryUser)
class UnreachableUserRepository extends BaseUserRepository<DirectoryUser>() {
    override async findByEmail(): Promise<DirectoryUser> {
        return await Promise.reject(new Error('connect ECONNREFUSED - the user directory is unreachable'));
    }
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, DirectoryUser],
    repositories: [...defaultTestServerRepositories, UnreachableUserRepository]
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
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

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