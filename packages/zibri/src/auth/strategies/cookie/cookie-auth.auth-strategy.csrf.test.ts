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
import { AuditEntry } from '../../../audit/audit-entry.model';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { PropertyMetadata } from '../../../entity/decorators/property.decorator';
import { AuditAction, AuditReason } from '../../../logging/audit-event.model';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../authenticators/password/password-credentials.model';
import { Auth } from '../../decorators/auth.decorator';
import { CurrentUser } from '../../decorators/current-user.decorator';

const PASSWORD: string = 'correct horse battery staple';

/**
 * The cookies of a login, as a cookie header, and the csrf token that goes with them.
 */
type Session = {
    cookie: string,
    csrfToken: string
};

@Controller('/tasks')
class TaskController {
    @Auth.isLoggedIn()
    @Post('/')
    create(): { ok: boolean } {
        return { ok: true };
    }

    @Auth.skip()
    @Post('/preview')
    preview(@CurrentUser({ required: false }) user: CurrentUser | undefined): string {
        return user == undefined ? 'anonymous' : user.id;
    }
}

let server: StartedTestServer;
let baseUrl: string;

/**
 * Creates a user and logs them in with their password.
 * @param name - What sets the user's email apart.
 * @returns The cookies and csrf token of the login.
 */
async function login(name: string): Promise<Session> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: `${name}@csrf.test`, roles: [Roles.USER] });
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    await credentials.create({ userId: user.id, password: PASSWORD });
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email: user.email, password: PASSWORD })
    });
    expect(res.status).toBe(200);
    const cookie: string = res.headers.getSetCookie().map(c => c.split(';')[0])
        .join('; ');
    return { cookie, csrfToken: (await res.json() as { csrfToken: string }).csrfToken };
}

/**
 * Posts to a route with the cookies of a login.
 * @param path - The route.
 * @param session - The login.
 * @param csrfToken - The csrf token to send, if any.
 * @returns The response.
 */
async function post(path: string, session: Session, csrfToken: string | undefined): Promise<Response> {
    return await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { cookie: session.cookie, ...csrfToken == undefined ? {} : { 'x-csrf-token': csrfToken } }
    });
}

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, CookieAuthSession, CookieAuthRefreshSession],
                repositories: defaultTestServerRepositories
            })
        ],
        authStrategies: [CookieAuthStrategy],
        controllers: [CookieTestAuthController, TaskController],
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

describe('CookieAuthStrategy - a session sent without its csrf token', () => {
    it('refuses a route that needs a login as a csrf failure, not as no login', async () => {
        const session: Session = await login('missing');

        const missing: Response = await post('/tasks', session, undefined);
        const wrong: Response = await post('/tasks', session, `${session.csrfToken}x`);

        // a 401 sends a front end that lost its token to log in again, and the trail could not tell a
        // forged request from an anonymous one
        expect(missing.status).toBe(403);
        expect(wrong.status).toBe(403);
        await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
        const entries: AuditEntry[] = await inject(repositoryTokenFor(AuditEntry)).findAll({
            where: { action: AuditAction.AUTHORIZATION, reason: AuditReason.CSRF },
            acrossTenants: true
        });
        expect(entries.reduce((count, e) => count + e.count, 0)).toBe(2);
        expect((await post('/tasks', session, session.csrfToken)).status).toBe(200);
    });

    it('serves a route that skips auth as to nobody', async () => {
        const session: Session = await login('skips');

        const res: Response = await post('/tasks/preview', session, undefined);

        expect(res.status).toBe(200);
        expect(await res.json()).toBe('anonymous');
    });

    it('lets the user log in again', async () => {
        const session: Session = await login('again');

        const res: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: session.cookie },
            body: JsonUtilities.stringify({ email: 'again@csrf.test', password: PASSWORD })
        });

        expect(res.status).toBe(200);
    });
});

describe('CookieAuthSession and CookieAuthRefreshSession', () => {
    // a cookie carrying the primary key cannot be hashed, so a backup, a replica or a support query
    // would hold a working login for every session in the tables
    it('keep what the session cookies carry hashed, and no csrf token at all', () => {
        const sessionProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(CookieAuthSession);
        const refreshProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(CookieAuthRefreshSession);

        expect(sessionProps['token']).toMatchObject({ hash: expect.anything() });
        expect(sessionProps['token']).not.toMatchObject({ hash: false });
        expect(refreshProps['token']).toMatchObject({ hash: expect.anything() });
        expect(refreshProps['token']).not.toMatchObject({ hash: false });
        expect(refreshProps['csrfToken']).toBeUndefined();
    });
});