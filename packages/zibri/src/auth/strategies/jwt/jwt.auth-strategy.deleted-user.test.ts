import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { JwtAuthStrategy } from './jwt.auth-strategy';
import { TestTimeouts } from '../../../__testing__/constants';
import { JwtTestAuthController } from '../../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { SoftDeleteEntity } from '../../../data-source/change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../../data-source/change-sets/soft-delete-repository';
import { Repository } from '../../../data-source/repository/repository';
import { RepositoryFor } from '../../../data-source/repository/repository-for.decorator';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../di/inject.function';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../authenticators/password/password-credentials.model';
import { BaseUserEntity } from '../../models/base-user.model';
import { BaseUserRepository } from '../../user/base-user-repository.model';

const PASSWORD: string = 'correct horse battery staple';

/**
 * What a login answers, as far as these cases read it.
 */
type Tokens = {
    refreshToken: { value: string }
};

/**
 * A user entity that soft deletes, so that a deleted user keeps their refresh tokens.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class ArchivedUser extends BaseUserEntity(SoftDeleteEntity, { deletedUserKeepsEmail: false }) {}

@RepositoryFor(ArchivedUser)
class ArchivedUserRepository extends BaseUserRepository<ArchivedUser>(SoftDeleteRepository) {}

let server: StartedTestServer;
let baseUrl: string;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ArchivedUser],
                repositories: [...defaultTestServerRepositories, ArchivedUserRepository]
            })
        ],
        authStrategies: [JwtAuthStrategy],
        controllers: [JwtTestAuthController],
        providers: defaultTestServerProviders
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// 04 §A10: a refresh looked its user up as required, so the refresh token a soft deleted user keeps
// answered 404 with the user's id instead of the refusal any other spent login gets
describe('JwtAuthStrategy - the refresh token of a deleted user', () => {
    it('refuses a refresh', async () => {
        const users: ArchivedUserRepository = inject(ArchivedUserRepository);
        const user: ArchivedUser = await users.create({ email: 'refresh@deleted.test', roles: [] });
        const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
        await credentials.create({ userId: user.id, password: PASSWORD });
        const login: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JsonUtilities.stringify({ email: user.email, password: PASSWORD })
        });
        expect(login.status).toBe(200);
        const refreshToken: string = (await login.json() as Tokens).refreshToken.value;
        await users.deleteById(user.id);

        const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JsonUtilities.stringify({ refreshToken })
        });

        expect(res.status).toBe(401);
    });
});
