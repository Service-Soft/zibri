import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { TestTimeouts } from '../../../__testing__/constants';
import { JwtTestAuthController } from '../../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { createTestDataSource } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../../auth/authenticators/password/password-credentials.model';
import { JwtAuthStrategy } from '../../../auth/strategies/jwt/jwt.auth-strategy';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../di/inject.function';
import { KnownHeader } from '../../../http/known-header.enum';
import { MimeType } from '../../../http/mime-type.enum';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { Repository } from '../../repository/repository';

const PASSWORD: string = 'correct horse battery staple';

const dataSourceClass: ReturnType<typeof createTestDataSource> = createTestDataSource();

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * Hands over the started server.
 * @returns The server.
 * @throws When the server did not start.
 */
function getServer(): StartedTestServer {
    if (server == undefined) {
        throw new Error('the server did not start');
    }
    return server;
}

/**
 * Creates a user with a password.
 * @returns The user's email.
 */
async function createUser(): Promise<string> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${UUIDUtilities.generate()}@outage.test`, roles: [Roles.USER] });
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ userId: user.id, password: PASSWORD });
    return user.email;
}

/**
 * Logs in, which reads the user and writes a login.
 * @param email - Who logs in.
 * @returns The status of the answer.
 */
async function login(email: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify({ email, password: PASSWORD })
    });
    await res.arrayBuffer();
    return res.status;
}

/**
 * The role the application connects as.
 * @returns Its name.
 */
function resolveApplicationRole(): string {
    return inject(dataSourceClass).options.username ?? 'postgres';
}

// nothing showed that a running instance serves again once its database is back, which is the
// first thing whoever is on call needs to know: whether to restart every instance or wait
describe('an application whose database goes away and comes back', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy],
            controllers: [JwtTestAuthController]
        });
        baseUrl = await server.start();
    }, TestTimeouts.postgres.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.postgres.shutdown);

    // at once, not once the pool noticed: a connection the server ends tells its client a moment later, and a
    // request taking it before then failed. Several times, since a request does not lose that race every time
    it('serves at once once its connections were dropped, as a restart of the database drops them', async () => {
        const email: string = await createUser();
        expect(await login(email)).toBe(200);

        for (let i: number = 0; i < 5; i++) {
            await getServer().runAsSuperuser(dataSourceClass, [`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '${resolveApplicationRole()}'`]);

            expect(await login(email)).toBe(200);
        }
    }, 30000);

    it('fails what needs the database while it takes no connections, and serves again once it does', async () => {
        const email: string = await createUser();
        expect(await login(email)).toBe(200);
        const role: string = resolveApplicationRole();

        // the server stays up and refuses the application, so that nothing about its address or its
        // port changes the way a restarted container could
        await getServer().runAsSuperuser(dataSourceClass, [
            `ALTER ROLE "${role}" NOLOGIN`,
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '${role}'`
        ]);
        let during: number;
        try {
            during = await login(email);
        }
        finally {
            await getServer().runAsSuperuser(dataSourceClass, [`ALTER ROLE "${role}" LOGIN`]);
        }

        // answered rather than left hanging, and as a failure on the server's side
        expect(during).toBeGreaterThanOrEqual(500);
        expect(await login(email)).toBe(200);
    });
});