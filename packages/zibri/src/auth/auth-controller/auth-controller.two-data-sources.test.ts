import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { AuthController } from './auth-controller.model';
import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { MigrationEntity } from '../../data-source/migration/migration-entity.model';
import { Repository } from '../../data-source/repository/repository';
import { RepositoryClass } from '../../data-source/repository/repository-class.type';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { OtpTwoFactorMethod } from '../2fa/methods/otp/otp.two-factor-method';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../authenticators/password/password.authenticator';
import { Authentication } from '../models/authentication.model';
import { PasswordPolicy } from '../password-policy/password-policy.model';
import { JwtAuthData } from '../strategies/jwt/jwt-auth-data.model';
import { JwtRefreshToken } from '../strategies/jwt/jwt-refresh-token.model';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy';

/**
 * The data source of the users and their passwords.
 */
@DataSource()
class CredentialsDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities.filter(e => e !== JwtRefreshToken);
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * The data source of the logins, apart from the passwords they start with.
 */
@DataSource()
class SessionsDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [MigrationEntity, JwtRefreshToken];
    override readonly repositories: RepositoryClass[] = [];
}

/**
 * Whether a login fails once its refresh token is written, as a store failing after the write would.
 */
let failingLogins: boolean = false;

/**
 * The jwt strategy, failing a login after its refresh token is written while `failingLogins` is set.
 */
class FailingJwtAuthStrategy extends JwtAuthStrategy<string, JwtUser> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    override async startLogin(authentication: Authentication<JwtUser>, transaction: RepositoryTransaction | undefined): Promise<JwtAuthData<string>> {
        const authData: JwtAuthData<string> = await super.startLogin(authentication, transaction);
        if (failingLogins) {
            throw new Error('The login could not be stored.');
        }
        return authData;
    }
}

// an orphan for the suites that import this file's siblings without registering it
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class TwoDataSourcesAuthController extends AuthController({
        strategies: [FailingJwtAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

/**
 * What the login route answers when it waits for a new password.
 */
type PendingLoginBody = {
    name: string,
    ticket: string
};

/**
 * What the login route answers once the user is logged in.
 */
type TokenBody = {
    refreshToken: { value: string }
};

const policy: PasswordPolicy = { minLength: 8, outdatedPasswords: 'requireChange' };

let server: StartedTestServer;
let baseUrl: string;
let ticketHeader: string;

/**
 * Creates a user with a password.
 * @param password - The password.
 * @returns The user.
 */
async function createUser(password: string): Promise<JwtUser> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${UUIDUtilities.generate()}@two-data-sources.test`, roles: [Roles.USER] });
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ userId: user.id, password });
    return user;
}

/**
 * Posts json to a route of the auth controller.
 * @param path - The route below `/auth`.
 * @param body - The body.
 * @param headers - What else the request carries.
 * @returns The response.
 */
async function post(path: string, body: object, headers: Record<string, string> = {}): Promise<Response> {
    return await fetch(`${baseUrl}/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JsonUtilities.stringify(body)
    });
}

/**
 * Sends a user's password to the login route.
 * @param user - The user.
 * @param password - The password.
 * @returns The response.
 */
async function login(user: JwtUser, password: string): Promise<Response> {
    return await post('/login', { email: user.email, password });
}

/**
 * Logs a user in up to the new password the login waits for.
 * @param user - The user.
 * @param password - The password.
 * @returns The ticket the new password is set with.
 */
async function passwordChangeTicketOf(user: JwtUser, password: string): Promise<string> {
    await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).requirePasswordChange(user.id, undefined);
    const res: Response = await login(user, password);
    const body: PendingLoginBody = await res.json() as PendingLoginBody;
    expect([res.status, body.name]).toEqual([401, 'PasswordChangeRequiredError']);
    return body.ticket;
}

/**
 * The refresh tokens a user holds, which is what a login leaves behind.
 * @param user - The user.
 * @returns How many.
 */
async function loginsOf(user: JwtUser): Promise<number> {
    return (await inject(SessionsDataSource).getRepository(JwtRefreshToken).findAll({ where: { userId: user.id } })).length;
}

describe('AuthController - logins kept in another data source than the passwords', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [CredentialsDataSource, SessionsDataSource],
            authStrategies: [FailingJwtAuthStrategy],
            authenticators: [PasswordAuthenticator],
            controllers: [TwoDataSourcesAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.PASSWORD_POLICY, useValue: policy })
            ]
        });
        baseUrl = await server.start();
        ticketHeader = inject(ZIBRI_DI_TOKENS.LOGIN_TICKET_HEADER);
    }, TestTimeouts.inMemory.start);

    afterEach(() => {
        failingLogins = false;
    });

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('logs in, refreshes the login and logs out', async () => {
        const user: JwtUser = await createUser('first password');

        const loggedIn: Response = await login(user, 'first password');
        expect(loggedIn.status).toBe(200);
        const refreshToken: string = (await loggedIn.json() as TokenBody).refreshToken.value;
        const refreshed: Response = await post('/refresh-login', { refreshToken });
        expect(refreshed.status).toBe(200);
        const logout: Response = await post('/logout', { refreshToken: (await refreshed.json() as TokenBody).refreshToken.value });

        expect(logout.status).toBe(200);
        expect(await loginsOf(user)).toBe(0);
    });

    it('sets the new password a login waits for, and logs in with it', async () => {
        const user: JwtUser = await createUser('first password');
        const ticket: string = await passwordChangeTicketOf(user, 'first password');

        const res: Response = await post('/login/change-password', { newPassword: 'second password' }, { [ticketHeader]: ticket });

        expect(res.status).toBe(200);
        expect(await loginsOf(user)).toBe(1);
        expect((await login(user, 'first password')).status).toBe(401);
        expect((await login(user, 'second password')).status).toBe(200);
    });

    it('keeps the old password when the login after the new one cannot be stored', async () => {
        const user: JwtUser = await createUser('first password');
        const ticket: string = await passwordChangeTicketOf(user, 'first password');
        failingLogins = true;

        const res: Response = await post('/login/change-password', { newPassword: 'second password' }, { [ticketHeader]: ticket });
        failingLogins = false;

        expect(res.status).toBe(500);
        expect(await loginsOf(user)).toBe(0);
        expect((await login(user, 'second password')).status).toBe(401);
        // nor was the ticket spent
        expect((await post('/login/change-password', { newPassword: 'second password' }, { [ticketHeader]: ticket })).status).toBe(200);
    });
});
