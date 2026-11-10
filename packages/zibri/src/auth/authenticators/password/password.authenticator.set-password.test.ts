import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
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
import { AuditEntry } from '../../../audit/audit-entry.model';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { NotFoundError } from '../../../error-handling/errors/not-found.error';
import { KnownHeader } from '../../../http/known-header.enum';
import { MimeType } from '../../../http/mime-type.enum';
import { AuditAction, AuditOutcome } from '../../../logging/audit-event.model';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { Ms } from '../../../utilities/ms';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { AuthService } from '../../auth.service';
import { LoginTicket } from '../../models/login-ticket.model';
import { JwtRefreshToken } from '../../strategies/jwt/jwt-refresh-token.model';
import { JwtAuthStrategy } from '../../strategies/jwt/jwt.auth-strategy';

const OLD_PASSWORD: string = 'the one they forgot';
const NEW_PASSWORD: string = 'the one support set';
const MAX_FAILURES: number = 3;

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * Creates a user, with a password unless told otherwise.
 * @param password - The password, or undefined for a user who has none.
 * @returns The user.
 */
async function createUser(password: string | undefined = OLD_PASSWORD): Promise<JwtUser> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${UUIDUtilities.generate()}@set-password.test`, roles: [Roles.USER] });
    if (password != undefined) {
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ userId: user.id, password });
    }
    return user;
}

/**
 * Logs a user in with a password.
 * @param user - The user.
 * @param password - The password.
 * @returns The status, and the name of the error the login answered with, if any.
 */
async function login(user: JwtUser, password: string): Promise<{ status: number, name: string | undefined }> {
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify({ email: user.email, password })
    });
    const body: { name?: string } = await res.json() as { name?: string };
    return { status: res.status, name: body.name };
}

// a support tool or a command letting a user back in had no way to set a password without the one
// the user had, other than writing their credentials, and their lock, by hand
describe('AuthService - setting a password without the one a user has', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, PasswordFailureStreak, LoginTicket],
                    repositories: defaultTestServerRepositories
                })
            ],
            authStrategies: [JwtAuthStrategy],
            controllers: [JwtTestAuthController],
            passwordFailureLimit: { maxFailures: MAX_FAILURES, lockForInMs: Ms.HOUR },
            providers: defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.AUTH_RATE_LIMIT_OPTIONS)
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('replaces the password, ends every login, and has the user choose their own at the next login', async () => {
        const user: JwtUser = await createUser();
        expect((await login(user, OLD_PASSWORD)).status).toBe(200);

        await inject(AuthService).setPassword(user.id, { password: NEW_PASSWORD, requireChange: true }, undefined);

        expect(await inject(repositoryTokenFor(JwtRefreshToken)).findAll({ where: { userId: user.id } })).toEqual([]);
        expect((await login(user, OLD_PASSWORD)).status).toBe(401);
        expect(await login(user, NEW_PASSWORD)).toEqual({ status: 401, name: 'PasswordChangeRequiredError' });
        await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
        const entries: AuditEntry[] = await inject(repositoryTokenFor(AuditEntry)).findAll({
            where: { action: AuditAction.PASSWORD_SET, userId: user.id },
            acrossTenants: true
        });
        expect(entries.map(e => e.outcome)).toEqual([AuditOutcome.SUCCESS]);
    });

    it('logs the user in with the password as it is, when no change is required', async () => {
        const user: JwtUser = await createUser();

        await inject(AuthService).setPassword(user.id, { password: NEW_PASSWORD, requireChange: false }, undefined);

        expect((await login(user, NEW_PASSWORD)).status).toBe(200);
    });

    it('lifts a lock of wrong passwords', async () => {
        const user: JwtUser = await createUser();
        for (let i: number = 0; i < MAX_FAILURES; i++) {
            await login(user, 'a wrong guess');
        }
        expect((await login(user, OLD_PASSWORD)).status).toBe(401);

        await inject(AuthService).setPassword(user.id, { password: NEW_PASSWORD, requireChange: false }, undefined);

        expect((await login(user, NEW_PASSWORD)).status).toBe(200);
    });

    it('gives a password to a user who has none', async () => {
        const user: JwtUser = await createUser(undefined);

        await inject(AuthService).setPassword(user.id, { password: NEW_PASSWORD, requireChange: false }, undefined);

        expect((await login(user, NEW_PASSWORD)).status).toBe(200);
    });

    it('refuses an id that names no user, and gives nobody credentials', async () => {
        const userId: string = UUIDUtilities.generate();

        await expect(inject(AuthService).setPassword(userId, { password: NEW_PASSWORD, requireChange: false }, undefined))
            .rejects.toThrow(NotFoundError);

        expect(await inject(repositoryTokenFor(PasswordCredentials)).findAll({ where: { userId } })).toEqual([]);
    });
});