import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { CookieTestAuthController } from '../../__testing__/mocks/controllers/cookie-test-auth.controller';
import { JwtTestAuthController } from '../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { AuditEntry } from '../../audit/audit-entry.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { KnownHeader } from '../../http/known-header.enum';
import { MimeType } from '../../http/mime-type.enum';
import { AuditAction, AuditOutcome } from '../../logging/audit-event.model';
import { JsonUtilities } from '../../utilities/json.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../authenticators/password/password-credentials.model';
import { CookieAuthRefreshSession } from '../strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../strategies/cookie/cookie-auth.auth-strategy';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy';

const PASSWORD: string = 'correct horse battery staple';

/**
 * The tokens of a login.
 */
type Login = {
    accessToken: string,
    refreshToken: string
};

/**
 * A login as `GET /auth/logins` lists it.
 */
type ListedLogin = {
    id: string,
    strategy: string,
    current: boolean,
    authenticatedAt?: string,
    lastUsedAt?: string,
    expiresAt: string,
    userAgent?: string,
    ipAddress?: string
};

let server: StartedTestServer | undefined;
let baseUrl: string;

// one for the servers of both strategies, each starting with its own store
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, CookieAuthSession, CookieAuthRefreshSession],
    repositories: defaultTestServerRepositories
});

/**
 * Creates a user with a password.
 * @returns The user's email.
 */
async function createUser(): Promise<string> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${UUIDUtilities.generate()}@logins.test`, roles: [Roles.USER] });
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ userId: user.id, password: PASSWORD });
    return user.email;
}

/**
 * Logs in with a password, from a client of the given name.
 * @param email - The user's email.
 * @param client - What the client sends as its `User-Agent`.
 * @param password - The password.
 * @returns The tokens.
 */
async function login(email: string, client: string, password: string = PASSWORD): Promise<Login> {
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON, [KnownHeader.USER_AGENT]: client },
        body: JsonUtilities.stringify({ email, password })
    });
    expect(res.status).toBe(200);
    const body: { accessToken: { value: string }, refreshToken: { value: string } } = await res.json() as {
        accessToken: { value: string },
        refreshToken: { value: string }
    };
    return { accessToken: body.accessToken.value, refreshToken: body.refreshToken.value };
}

/**
 * Calls an auth route as the holder of a login.
 * @param method - The http method.
 * @param path - The route below `/auth`.
 * @param loggedIn - The login.
 * @param body - What is sent, if anything.
 * @returns The response.
 */
async function call(method: string, path: string, loggedIn: Login, body?: object): Promise<Response> {
    return await fetch(`${baseUrl}/auth${path}`, {
        method,
        headers: {
            [KnownHeader.AUTHORIZATION]: `Bearer ${loggedIn.accessToken}`,
            ...body == undefined ? {} : { [KnownHeader.CONTENT_TYPE]: MimeType.JSON }
        },
        ...body == undefined ? {} : { body: JsonUtilities.stringify(body) }
    });
}

/**
 * Refreshes a login.
 * @param loggedIn - The login.
 * @param client - What the client sends as its `User-Agent`.
 * @returns The status of the answer.
 */
async function refresh(loggedIn: Login, client: string = 'Refreshing Client'): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON, [KnownHeader.USER_AGENT]: client },
        body: JsonUtilities.stringify({ refreshToken: loggedIn.refreshToken })
    });
    await res.arrayBuffer();
    return res.status;
}

/**
 * The logins of the user holding a login.
 * @param loggedIn - The login.
 * @returns The logins.
 */
async function findLogins(loggedIn: Login): Promise<ListedLogin[]> {
    const res: Response = await call('GET', '/logins', loggedIn);
    expect(res.status).toBe(200);
    return await res.json() as ListedLogin[];
}

// 04 §A11: a user could not see where they are logged in, end one of those logins, end all of them,
// or change their password, and every application wrote these again
describe('AuthController - the logins of a user', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy],
            controllers: [JwtTestAuthController],
            providers: defaultTestServerProviders
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('lists where the user is logged in, marking the login that asks', async () => {
        const email: string = await createUser();
        const laptop: Login = await login(email, 'Laptop Browser');
        await login(email, 'Phone App');

        const logins: ListedLogin[] = await findLogins(laptop);

        expect(logins).toHaveLength(2);
        expect(logins.map(l => [l.userAgent, l.current]).sort()).toEqual([['Laptop Browser', true], ['Phone App', false]]);
        expect(logins.every(l => l.strategy === 'jwt' && l.ipAddress != undefined && l.authenticatedAt != undefined)).toBe(true);
    });

    it('ends one login of the user, and leaves the others', async () => {
        const email: string = await createUser();
        const laptop: Login = await login(email, 'Laptop Browser');
        const phone: Login = await login(email, 'Phone App');
        const phoneLogin: ListedLogin | undefined = (await findLogins(laptop)).find(l => l.userAgent === 'Phone App');

        expect((await call('DELETE', `/logins/${phoneLogin?.id ?? ''}`, laptop)).status).toBe(204);

        expect(await refresh(phone)).toBe(401);
        expect((await findLogins(laptop)).map(l => l.userAgent)).toEqual(['Laptop Browser']);
        // another user's login is no login of this one
        const stranger: Login = await login(await createUser(), 'Stranger');
        const strangerLogin: ListedLogin | undefined = (await findLogins(stranger))[0];
        expect((await call('DELETE', `/logins/${strangerLogin?.id ?? ''}`, laptop)).status).toBe(404);
        expect(await refresh(stranger)).toBe(200);
    });

    it('ends every login of the user', async () => {
        const email: string = await createUser();
        const laptop: Login = await login(email, 'Laptop Browser');
        const phone: Login = await login(email, 'Phone App');

        expect((await call('POST', '/logout-everywhere', laptop)).status).toBe(204);

        expect(await refresh(laptop)).toBe(401);
        expect(await refresh(phone)).toBe(401);
    });

    it('changes the password of a user who knows it, and ends their other logins', async () => {
        const email: string = await createUser();
        const laptop: Login = await login(email, 'Laptop Browser');
        const phone: Login = await login(email, 'Phone App');

        const wrong: Response = await call('POST', '/change-password', laptop, { currentPassword: 'not it', newPassword: 'a new passphrase' });
        // refused for what was sent rather than for the login, which a 401 would send a client to refresh
        expect(wrong.status).toBe(403);
        const changed: Response = await call('POST', '/change-password', laptop, { currentPassword: PASSWORD, newPassword: 'a new passphrase' });
        expect(changed.status).toBe(204);

        // whoever else held a login before the change - the reason for one, more often than not
        expect(await refresh(phone)).toBe(401);
        expect(await refresh(laptop)).toBe(200);
        await login(email, 'Laptop Browser', 'a new passphrase');
        const old: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
            body: JsonUtilities.stringify({ email, password: PASSWORD })
        });
        expect(old.status).toBe(401);

        await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
        const entries: AuditEntry[] = await inject(repositoryTokenFor(AuditEntry)).findAll({
            where: { action: AuditAction.PASSWORD_CHANGED },
            acrossTenants: true
        });
        expect(entries.map(e => e.outcome).sort()).toEqual([AuditOutcome.FAILURE, AuditOutcome.SUCCESS]);
    });
});

describe('AuthController - at most so many logins of a user', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy],
            controllers: [JwtTestAuthController],
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.MAX_LOGINS_PER_USER, useValue: 2 })]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('ends the least recently used login once a login past the limit starts', async () => {
        const email: string = await createUser();
        const laptop: Login = await login(email, 'Laptop Browser');
        const oldest: Login = await login(email, 'Old Tablet');
        // started first and used since, so the tablet is the one used least recently
        expect(await refresh(laptop, 'Laptop Browser')).toBe(200);

        const phone: Login = await login(email, 'Phone App');

        expect(await refresh(oldest)).toBe(401);
        expect((await findLogins(phone)).map(l => l.userAgent).sort()).toEqual(['Laptop Browser', 'Phone App']);
    });
});

describe('AuthController - the logins of a user, with cookies', () => {
    /**
     * Logs in with a password and keeps the cookies.
     * @param email - The user's email.
     * @param client - What the client sends as its `User-Agent`.
     * @returns The cookie header and the csrf token of the login.
     */
    async function loginWithCookies(email: string, client: string): Promise<{ cookie: string, csrfToken: string }> {
        const res: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON, [KnownHeader.USER_AGENT]: client },
            body: JsonUtilities.stringify({ email, password: PASSWORD })
        });
        expect(res.status).toBe(200);
        const cookie: string = res.headers.getSetCookie().map(c => c.split(';')[0])
            .join('; ');
        return { cookie, csrfToken: (await res.json() as { csrfToken: string }).csrfToken };
    }

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [CookieAuthStrategy],
            controllers: [CookieTestAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('lists the logins of the user, and ends one', async () => {
        const email: string = await createUser();
        const laptop: { cookie: string, csrfToken: string } = await loginWithCookies(email, 'Laptop Browser');
        const phone: { cookie: string, csrfToken: string } = await loginWithCookies(email, 'Phone Browser');

        const listed: Response = await fetch(`${baseUrl}/auth/logins`, { headers: { cookie: laptop.cookie } });
        expect(listed.status).toBe(200);
        const logins: ListedLogin[] = await listed.json() as ListedLogin[];
        expect(logins.map(l => [l.userAgent, l.current, l.strategy]).sort()).toEqual([
            ['Laptop Browser', true, 'cookie'],
            ['Phone Browser', false, 'cookie']
        ]);

        const phoneLogin: ListedLogin | undefined = logins.find(l => !l.current);
        const ended: Response = await fetch(`${baseUrl}/auth/logins/${phoneLogin?.id ?? ''}`, {
            method: 'DELETE',
            headers: { cookie: laptop.cookie, 'x-csrf-token': laptop.csrfToken }
        });
        expect(ended.status).toBe(204);
        expect((await fetch(`${baseUrl}/auth/logins`, { headers: { cookie: phone.cookie } })).status).toBe(401);
    });
});