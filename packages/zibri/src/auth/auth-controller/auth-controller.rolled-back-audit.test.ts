import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { AuthController } from './auth-controller.model';
import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { AuditEntry } from '../../audit/audit-entry.model';
import { Repository } from '../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { AuditAction, AuditOutcome } from '../../logging/audit-event.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { JsonUtilities } from '../../utilities/json.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { OtpTwoFactorMethod } from '../2fa/methods/otp/otp.two-factor-method';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../authenticators/password/password.authenticator';
import { Authentication } from '../models/authentication.model';
import { JwtAuthData } from '../strategies/jwt/jwt-auth-data.model';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy';

/**
 * The jwt strategy, failing every login once its refresh token is written.
 */
class FailingJwtAuthStrategy extends JwtAuthStrategy<string, JwtUser> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    override async startLogin(authentication: Authentication<JwtUser>, transaction: RepositoryTransaction | undefined): Promise<JwtAuthData<string>> {
        await super.startLogin(authentication, transaction);
        throw new Error('The login could not be stored.');
    }
}

// an orphan for the suites that import this file's siblings without registering it
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class RolledBackAuditAuthController extends AuthController({
        strategies: [FailingJwtAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

let server: StartedTestServer;
let baseUrl: string;

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

// 12 §B10: the trail was written as each step happened, beside the transaction, so a step its
// rollback undid stayed recorded as done
describe('AuthController - the audit trail of a password change at login that is rolled back', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
            authStrategies: [FailingJwtAuthStrategy],
            authenticators: [PasswordAuthenticator],
            controllers: [RolledBackAuditAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.PASSWORD_POLICY, useValue: { minLength: 8, outdatedPasswords: 'requireChange' } })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('records no changed password, and the failed login', async () => {
        const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
            .create({ email: `${UUIDUtilities.generate()}@rolled-back-audit.test`, roles: [Roles.USER] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ userId: user.id, password: 'first password' });
        await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).requirePasswordChange(user.id, undefined);
        const ticket: string = (await (await post('/login', { email: user.email, password: 'first password' })).json() as { ticket: string }).ticket;

        const res: Response = await post('/login/change-password', { newPassword: 'second password' }, {
            [inject(ZIBRI_DI_TOKENS.LOGIN_TICKET_HEADER)]: ticket
        });
        expect(res.status).toBe(500);

        await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
        const changed: AuditEntry[] = await inject(repositoryTokenFor(AuditEntry)).findAll({
            where: { action: AuditAction.PASSWORD_CHANGED, outcome: AuditOutcome.SUCCESS, userId: user.id },
            acrossTenants: true
        });
        expect(changed).toEqual([]);
        const failed: AuditEntry[] = await inject(repositoryTokenFor(AuditEntry)).findAll({
            where: { action: AuditAction.LOGIN, outcome: AuditOutcome.FAILURE, userId: user.id },
            acrossTenants: true
        });
        expect(failed).toHaveLength(1);
    });
});
