import { setTimeout as wait } from 'node:timers/promises';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
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
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { AuditAction, AuditEvent, AuditReason } from '../../../logging/audit-event.model';
import { Log } from '../../../logging/log.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../authenticators/password/password-credentials.model';
import { Auth } from '../../decorators/auth.decorator';

const PASSWORD: string = 'correct horse battery staple';
const GRACE_IN_MS: number = 1000;
const SESSION_COOKIE: string = 'sessionId';
const REFRESH_COOKIE: string = 'refreshSessionId';

/**
 * The cookies a response set, by name, and the csrf token that goes with them.
 */
type Session = {
    cookies: Record<string, string>,
    csrfToken: string
};

@Controller('/me')
class MeController {
    @Auth.isLoggedIn()
    @Get('/')
    me(): { ok: boolean } {
        return { ok: true };
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
 * Creates a user and logs them in.
 * @param name - What sets the user's email apart.
 * @returns The cookies and csrf token of the login.
 */
async function loginAs(name: string): Promise<Session> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: `${name}@grace.test`, roles: [Roles.USER] });
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    await credentials.create({ userId: user.id, password: PASSWORD });
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email: user.email, password: PASSWORD })
    });
    expect(res.status).toBe(200);
    return { cookies: cookiesOf(res), csrfToken: (await res.json() as { csrfToken: string }).csrfToken };
}

/**
 * Refreshes with the refresh cookie of a session alone, as a browser whose session cookie lapsed does.
 * @param session - The session.
 * @returns The response.
 */
async function refreshWith(session: Session): Promise<Response> {
    return await fetch(`${baseUrl}/auth/refresh-login`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: cookieHeader(session, [REFRESH_COOKIE]),
            'x-csrf-token': session.csrfToken
        },
        body: '{}'
    });
}

/**
 * Refreshes and reads the session it is answered with.
 * @param session - The session presented.
 * @returns The new session.
 */
async function refreshed(session: Session): Promise<Session> {
    const res: Response = await refreshWith(session);
    expect(res.status).toBe(200);
    return { cookies: cookiesOf(res), csrfToken: (await res.json() as { csrfToken: string }).csrfToken };
}

/**
 * Calls a route that needs a login, with both cookies of a session.
 * @param session - The session.
 * @returns The status.
 */
async function meWith(session: Session): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/me`, { headers: { cookie: cookieHeader(session, [SESSION_COOKIE, REFRESH_COOKIE]) } });
    return res.status;
}

/**
 * The reasons the trail recorded for refused refreshes.
 * @returns The reasons, oldest first.
 */
async function refreshFailureReasons(): Promise<(AuditReason | undefined)[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return (await inject(repositoryTokenFor(Log)).findAll({}))
        .map(l => l.context.metadata?.['audit'] as AuditEvent | undefined)
        .filter((event): event is AuditEvent => event?.action === AuditAction.REFRESH_LOGIN && event.outcome === 'failure')
        .map(event => event.reason);
}

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, CookieAuthSession, CookieAuthRefreshSession], repositories: defaultTestServerRepositories })],
        authStrategies: [CookieAuthStrategy],
        controllers: [CookieTestAuthController, MeController],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
            // short, so that a case can wait it out
            defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_AUTH_REFRESH_SESSION_REUSE_GRACE_IN_MS, useValue: GRACE_IN_MS })
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('CookieAuthStrategy - a lapsed session cookie', () => {
    it('renews the session inside a request that carries the refresh cookie alone', async () => {
        const session: Session = await loginAs('lapsed');

        // what a browser sends once the session lapsed: the session cookie's maxAge is the session's
        // lifetime, so it is gone, and the refresh cookie is not
        const res: Response = await fetch(`${baseUrl}/me`, { headers: { cookie: cookieHeader(session, [REFRESH_COOKIE]) } });
        expect(res.status).toBe(200);

        const renewed: Session = { cookies: cookiesOf(res), csrfToken: res.headers.get('x-csrf-token') ?? '' };
        expect(renewed.cookies[SESSION_COOKIE]).toBeDefined();
        expect(renewed.csrfToken).not.toBe('');
        expect(renewed.csrfToken).not.toBe(session.csrfToken);
        expect(await meWith(renewed)).toBe(200);
    });

    it('refuses a session cookie that names no session, even next to a valid refresh cookie', async () => {
        const session: Session = await loginAs('deleted-session');
        await inject<Repository<CookieAuthSession>>(repositoryTokenFor(CookieAuthSession)).deleteAll({});

        expect(await meWith(session)).toBe(401);
    });
});

describe('CookieAuthStrategy - replaced cookies within the grace', () => {
    afterEach(async () => {
        await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
        await inject(repositoryTokenFor(Log)).deleteAll({});
    });

    it('gives a request sent with the replaced cookies a pair of its own, and keeps both', async () => {
        const original: Session = await loginAs('two-tabs');
        const first: Session = await refreshed(original);

        // the request that was on the wire with the old cookies when the first one rotated them
        const second: Session = await refreshed(original);

        expect(second.cookies[REFRESH_COOKIE]).not.toBe(first.cookies[REFRESH_COOKIE]);
        expect(await meWith(first)).toBe(200);
        expect(await meWith(second)).toBe(200);
        expect(await refreshFailureReasons()).toEqual([]);
    });

    it('keeps a request sent with the replaced cookies logged in on an ordinary route', async () => {
        const original: Session = await loginAs('page-load');
        const rotated: Session = await refreshed(original);

        expect(await meWith(original)).toBe(200);
        expect(await meWith(rotated)).toBe(200);
    });

    it('ends the login everywhere when the replaced cookies come back after the grace', async () => {
        const original: Session = await loginAs('stolen');
        const successor: Session = await refreshed(original);
        await wait(GRACE_IN_MS + 100);

        expect((await refreshWith(original)).status).toBe(401);

        expect(await meWith(successor)).toBe(401);
        expect(await refreshFailureReasons()).toEqual([AuditReason.TOKEN_REUSED]);
    });
});