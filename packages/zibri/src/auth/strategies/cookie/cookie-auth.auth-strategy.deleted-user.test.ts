import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { CookieAuthRefreshSession } from './cookie-auth-refresh-session.model';
import { CookieAuthSession } from './cookie-auth-session.model';
import { CookieAuthStrategy } from './cookie-auth.auth-strategy';
import { TestTimeouts } from '../../../__testing__/constants';
import { CookieTestAuthController } from '../../../__testing__/mocks/controllers/cookie-test-auth.controller';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { SoftDeleteEntity } from '../../../data-source/change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../../data-source/change-sets/soft-delete-repository';
import { Repository } from '../../../data-source/repository/repository';
import { RepositoryFor } from '../../../data-source/repository/repository-for.decorator';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../authenticators/password/password-credentials.model';
import { Auth } from '../../decorators/auth.decorator';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { BaseUserEntity } from '../../models/base-user.model';
import { BaseUserRepository } from '../../user/base-user-repository.model';

const PASSWORD: string = 'correct horse battery staple';
const SESSION_COOKIE: string = 'sessionId';
const REFRESH_COOKIE: string = 'refreshSessionId';

/**
 * The cookies a response set, by name, and the csrf token that goes with them.
 */
type Session = {
    cookies: Record<string, string>,
    csrfToken: string
};

/**
 * A user entity that soft deletes, so that a deleted user keeps their sessions.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class ArchivedUser extends BaseUserEntity(SoftDeleteEntity, { deletedUserKeepsEmail: false }) {}

@RepositoryFor(ArchivedUser)
class ArchivedUserRepository extends BaseUserRepository<ArchivedUser>(SoftDeleteRepository) {}

@Controller('/me')
class MeController {
    @Auth.isLoggedIn()
    @Get('/')
    me(): { ok: boolean } {
        return { ok: true };
    }

    @Auth.skip()
    @Get('/optional')
    optional(@CurrentUser({ required: false }) user: CurrentUser | undefined): string {
        return user == undefined ? 'anonymous' : user.id;
    }
}

let server: StartedTestServer;
let baseUrl: string;

/**
 * Reads the cookies a response set.
 * @param res - The response.
 * @returns The cookies by name.
 */
function cookiesOf(res: Response): Record<string, string> {
    const cookies: Record<string, string> = {};
    for (const cookie of res.headers.getSetCookie()) {
        const [pair = ''] = cookie.split(';');
        cookies[pair.slice(0, pair.indexOf('='))] = pair.slice(pair.indexOf('=') + 1);
    }
    return cookies;
}

/**
 * The cookie header sending the given cookies of a session.
 * @param session - The session.
 * @param names - Which of its cookies to send.
 * @returns The header value.
 */
function cookieHeader(session: Session, names: string[]): string {
    return names.map(name => `${name}=${session.cookies[name]}`).join('; ');
}

/**
 * Logs a user in with their password.
 * @param userId - The user.
 * @param email - Their email.
 * @returns The cookies and csrf token of the login.
 */
async function loginAs(userId: string, email: string): Promise<Session> {
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    await credentials.create({ userId, password: PASSWORD });
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email, password: PASSWORD })
    });
    expect(res.status).toBe(200);
    return { cookies: cookiesOf(res), csrfToken: (await res.json() as { csrfToken: string }).csrfToken };
}

/**
 * Creates a soft deleting user, logs them in and deletes them, which keeps their sessions.
 * @param name - What sets the user's email apart.
 * @returns The cookies and csrf token of the login.
 */
async function loginAsSoftDeleted(name: string): Promise<Session> {
    const users: ArchivedUserRepository = inject(ArchivedUserRepository);
    const user: ArchivedUser = await users.create({ email: `${name}@deleted.test`, roles: [] });
    const session: Session = await loginAs(user.id, user.email);
    await users.deleteById(user.id);
    return session;
}

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ArchivedUser, CookieAuthSession, CookieAuthRefreshSession],
                repositories: [...defaultTestServerRepositories, ArchivedUserRepository]
            })
        ],
        authStrategies: [CookieAuthStrategy],
        controllers: [CookieTestAuthController, MeController],
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

// 04 §A10: the strategy looked the user up as required, so the cookies of a user who is gone made
// every route answer 404 with the user's id, where every other strategy answers as for no login
describe('CookieAuthStrategy - the cookies of a deleted user', () => {
    it('answers a route that needs a login as for no login', async () => {
        const session: Session = await loginAsSoftDeleted('needs-login');

        const res: Response = await fetch(`${baseUrl}/me`, { headers: { cookie: cookieHeader(session, [SESSION_COOKIE, REFRESH_COOKIE]) } });

        expect(res.status).toBe(401);
    });

    it('serves a route that skips auth as to nobody', async () => {
        const session: Session = await loginAsSoftDeleted('skips-auth');

        const res: Response = await fetch(`${baseUrl}/me/optional`, { headers: { cookie: cookieHeader(session, [SESSION_COOKIE, REFRESH_COOKIE]) } });

        expect(res.status).toBe(200);
        expect(await res.json()).toBe('anonymous');
    });

    it('renews nothing for a request carrying the refresh cookie alone', async () => {
        const session: Session = await loginAsSoftDeleted('lapsed');

        const res: Response = await fetch(`${baseUrl}/me`, { headers: { cookie: cookieHeader(session, [REFRESH_COOKIE]) } });

        expect(res.status).toBe(401);
        expect(cookiesOf(res)[SESSION_COOKIE]).toBeUndefined();
    });

    it('refuses a refresh', async () => {
        const session: Session = await loginAsSoftDeleted('refresh');

        const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: cookieHeader(session, [REFRESH_COOKIE]), 'x-csrf-token': session.csrfToken },
            body: '{}'
        });

        expect(res.status).toBe(401);
    });

    it('answers as for no login once the user is deleted for good', async () => {
        const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
        const user: JwtUser = await users.create({ email: 'gone@deleted.test', roles: [Roles.USER] });
        const session: Session = await loginAs(user.id, user.email);
        await users.deleteById(user.id);

        const res: Response = await fetch(`${baseUrl}/me`, { headers: { cookie: cookieHeader(session, [SESSION_COOKIE, REFRESH_COOKIE]) } });

        expect(res.status).toBe(401);
    });
});