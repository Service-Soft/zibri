import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, FakeDpopKey, InMemoryDataSource } from 'zibri-testing';

import { JwtAuthOptionsInput } from './jwt-auth-options.model.ts';
import { JwtAuthStrategy } from './jwt.auth-strategy.ts';
import { JwtUtilities } from './jwt.utilities.ts';
import { JwtTestAuthController } from '../../../__testing__/mocks/controllers/jwt-test-auth.controller.ts';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { defineProvider, DiProvider } from '../../../di/models/di-provider.model.ts';
import { GlobalRegistry } from '../../../global/global-registry.ts';
import { Controller } from '../../../routing/decorators/controller.decorator.ts';
import { Get } from '../../../routing/decorators/get.decorator.ts';
import { Newable } from '../../../types/newable.type.ts';
import { JsonUtilities } from '../../../utilities/json.utilities.ts';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../authenticators/password/password-credentials.model.ts';
import { Auth } from '../../decorators/auth.decorator.ts';

/**
 * Something to present an access token to.
 */
@Controller('/dpop-test', { allowOrphan: true })
class DpopProtectedController {
    @Get('/me')
    @Auth.isLoggedIn([JwtAuthStrategy])
    me(): { ok: boolean } {
        return { ok: true };
    }
}

/**
 * The tokens of a login, as the routes answer them.
 */
type Tokens = {
    accessToken: string,
    refreshToken: string
};

/**
 * What an answer holds, as far as the tests read it.
 */
type Answer = {
    status: number,
    headers: Headers,
    body: Record<string, unknown>
};

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: defaultTestServerEntities });

const password: string = 'correct horse battery staple';

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * The providers of an application that binds logins as the options say.
 * @param requireDpop - Whether every login has to be bound to a DPoP key.
 * @param nonces - Whether DPoP proofs carry a nonce the application issued.
 * @returns The providers.
 */
function bindingLogins(requireDpop: boolean, nonces: boolean): DiProvider<unknown>[] {
    return [
        ...defaultTestServerProviders,
        defineProvider({
            token: ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT,
            useFactory: (): JwtAuthOptionsInput => ({
                accessTokenKey: 'test-access-token-secret',
                refreshTokenSecret: 'test-refresh-token-secret',
                requireDpop
            })
        }),
        defineProvider({ token: ZIBRI_DI_TOKENS.DPOP_NONCES, useFactory: () => nonces })
    ];
}

/**
 * Starts an application whose logins are bound as the providers say.
 * @param providers - What it runs with.
 * @returns The server, not yet listening.
 */
async function startApp(providers: DiProvider<unknown>[]): Promise<StartedTestServer> {
    return await startTestServer({
        dataSources: [dataSourceClass],
        controllers: [JwtTestAuthController, DpopProtectedController],
        providers
    });
}

/**
 * The url a route has as the application names itself, which is the url a proof is signed for.
 * @param path - The route.
 * @returns The url below the application's baseUrl.
 */
function urlOf(path: string): string {
    return `${GlobalRegistry.getAppData('baseUrl') ?? ''}${path}`;
}

/**
 * Sends a request, and reads the answer.
 * @param method - The http method.
 * @param path - The route.
 * @param headers - The headers to send.
 * @param body - The json body, if any.
 * @returns The answer.
 */
async function send(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Answer> {
    const res: Response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { ...body == undefined ? {} : { 'content-type': 'application/json' }, ...headers },
        body: body == undefined ? undefined : JsonUtilities.stringify(body)
    });
    const text: string = await res.text();
    const parsed: unknown = text ? JsonUtilities.parse(text) : {};
    return {
        status: res.status,
        headers: res.headers,
        body: typeof parsed === 'object' && parsed != undefined ? Object.fromEntries(Object.entries(parsed)) : {}
    };
}

/**
 * Reads the tokens out of the answer to a login or a refresh.
 * @param answer - The answer.
 * @returns The tokens.
 */
function tokensOf(answer: Answer): Tokens {
    expect(answer.status).toBe(200);
    const accessToken: unknown = answer.body['accessToken'];
    const refreshToken: unknown = answer.body['refreshToken'];
    const value: (jwt: unknown) => string = jwt => typeof jwt === 'object' && jwt != undefined && 'value' in jwt ? String(jwt.value) : '';
    return { accessToken: value(accessToken), refreshToken: value(refreshToken) };
}

/**
 * Creates a user who logs in with the password.
 * @param name - What sets the user's email apart.
 * @returns The email of the user.
 */
async function createUser(name: string): Promise<string> {
    const email: string = `${name}-${Date.now()}-${Math.random()}@dpop.test`;
    const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    const user: JwtUser = await users.create({ email, roles: [Roles.USER] });
    await credentials.create({ userId: user.id, password });
    return email;
}

/**
 * Logs a user in, with a proof of the key when one is given.
 * @param email - The email of the user.
 * @param key - The DPoP key to bind the login to, if any.
 * @returns The answer.
 */
async function login(email: string, key: FakeDpopKey | undefined): Promise<Answer> {
    const headers: Record<string, string> = key == undefined ? {} : { dpop: key.createProof('POST', urlOf('/auth/login')) };
    return await send('POST', '/auth/login', headers, { email, password });
}

/**
 * Refreshes a login, with a proof of the key when one is given.
 * @param refreshToken - The refresh token.
 * @param key - The DPoP key the request proves it holds, if any.
 * @returns The answer.
 */
async function refresh(refreshToken: string, key: FakeDpopKey | undefined): Promise<Answer> {
    const headers: Record<string, string> = key == undefined ? {} : { dpop: key.createProof('POST', urlOf('/auth/refresh-login')) };
    return await send('POST', '/auth/refresh-login', headers, { refreshToken });
}

/**
 * Calls the protected route with an access token bound to a key, sent as DPoP.
 * @param accessToken - The token.
 * @param key - The key to sign the proof with.
 * @returns The answer.
 */
async function callBound(accessToken: string, key: FakeDpopKey): Promise<Answer> {
    return await send('GET', '/dpop-test/me', {
        authorization: `DPoP ${accessToken}`,
        dpop: key.createProof('GET', urlOf('/dpop-test/me'), { accessToken })
    });
}

describe('JwtAuthStrategy — DPoP, by default', () => {
    beforeAll(async () => {
        server = await startApp(defaultTestServerProviders);
        baseUrl = await server.start();
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('binds only the logins that send a proof, which carries no nonce', async () => {
        const bearer: Tokens = tokensOf(await login(await createUser('default-bearer'), undefined));
        expect((await send('GET', '/dpop-test/me', { authorization: `Bearer ${bearer.accessToken}` })).status).toBe(200);

        const key: FakeDpopKey = new FakeDpopKey();
        const bound: Tokens = tokensOf(await login(await createUser('default-bound'), key));
        expect(JwtUtilities.findUnverifiedPayload(bound.accessToken)).toMatchObject({ cnf: { jkt: key.thumbprint } });
        expect((await callBound(bound.accessToken, key)).status).toBe(200);
    });
});

describe('JwtAuthStrategy — logins bound to a DPoP key when they send a proof', () => {
    beforeAll(async () => {
        server = await startApp(bindingLogins(false, false));
        baseUrl = await server.start();
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('binds a login to the key of the proof it is started with, which every request then proves', async () => {
        const key: FakeDpopKey = new FakeDpopKey();
        const tokens: Tokens = tokensOf(await login(await createUser('bound'), key));

        expect(JwtUtilities.findUnverifiedPayload(tokens.accessToken)).toMatchObject({ cnf: { jkt: key.thumbprint } });
        expect((await callBound(tokens.accessToken, key)).status).toBe(200);
        // as a bearer token, without a proof, or with a proof of another key, it is nothing
        expect((await send('GET', '/dpop-test/me', { authorization: `Bearer ${tokens.accessToken}` })).status).toBe(401);
        expect((await send('GET', '/dpop-test/me', { authorization: `DPoP ${tokens.accessToken}` })).status).toBe(401);
        expect((await callBound(tokens.accessToken, new FakeDpopKey())).status).toBe(401);
    });

    it('refuses a proof presented twice, for another route, or without the hash of the token', async () => {
        const key: FakeDpopKey = new FakeDpopKey();
        const { accessToken } = tokensOf(await login(await createUser('replayed'), key));
        const proof: string = key.createProof('GET', urlOf('/dpop-test/me'), { accessToken });

        expect((await send('GET', '/dpop-test/me', { authorization: `DPoP ${accessToken}`, dpop: proof })).status).toBe(200);
        const replayed: Answer = await send('GET', '/dpop-test/me', { authorization: `DPoP ${accessToken}`, dpop: proof });
        expect(replayed.status).toBe(401);
        expect(replayed.headers.get('www-authenticate')).toMatch(/^DPoP error="invalid_dpop_proof"/);
        expect(replayed.body).toMatchObject({ error: 'invalid_dpop_proof' });

        const elsewhere: string = key.createProof('GET', urlOf('/somewhere-else'), { accessToken });
        expect((await send('GET', '/dpop-test/me', { authorization: `DPoP ${accessToken}`, dpop: elsewhere })).status).toBe(401);
        const otherMethod: string = key.createProof('POST', urlOf('/dpop-test/me'), { accessToken });
        expect((await send('GET', '/dpop-test/me', { authorization: `DPoP ${accessToken}`, dpop: otherMethod })).status).toBe(401);
        const withoutHash: string = key.createProof('GET', urlOf('/dpop-test/me'));
        expect((await send('GET', '/dpop-test/me', { authorization: `DPoP ${accessToken}`, dpop: withoutHash })).status).toBe(401);
        const old: string = key.createProof('GET', urlOf('/dpop-test/me'), { accessToken, issuedAt: new Date(Date.now() - (60 * 60 * 1000)) });
        expect((await send('GET', '/dpop-test/me', { authorization: `DPoP ${accessToken}`, dpop: old })).status).toBe(401);
    });

    it('refreshes a bound login only with a proof of its key, and spends nothing without one', async () => {
        const key: FakeDpopKey = new FakeDpopKey();
        const tokens: Tokens = tokensOf(await login(await createUser('refreshed'), key));

        const withoutProof: Answer = await refresh(tokens.refreshToken, undefined);
        expect(withoutProof.status).toBe(400);
        expect(withoutProof.body).toMatchObject({ error: 'invalid_dpop_proof' });
        expect((await refresh(tokens.refreshToken, new FakeDpopKey())).status).toBe(400);

        // the refresh token was never spent, so whoever holds the key still refreshes with it
        const refreshed: Tokens = tokensOf(await refresh(tokens.refreshToken, key));
        expect(JwtUtilities.findUnverifiedPayload(refreshed.accessToken)).toMatchObject({ cnf: { jkt: key.thumbprint } });
        expect((await callBound(refreshed.accessToken, key)).status).toBe(200);
        expect(tokensOf(await refresh(refreshed.refreshToken, key)).accessToken).not.toBe('');
    });

    it('leaves a login without a proof a bearer login, which refuses the DPoP scheme', async () => {
        const tokens: Tokens = tokensOf(await login(await createUser('bearer'), undefined));

        expect(JwtUtilities.findUnverifiedPayload(tokens.accessToken)).not.toHaveProperty('cnf');
        expect((await send('GET', '/dpop-test/me', { authorization: `Bearer ${tokens.accessToken}` })).status).toBe(200);
        expect((await callBound(tokens.accessToken, new FakeDpopKey())).status).toBe(401);
        expect(tokensOf(await refresh(tokens.refreshToken, undefined)).accessToken).not.toBe('');
    });

    it('refuses a login whose proof is not valid for it', async () => {
        const key: FakeDpopKey = new FakeDpopKey();
        const answer: Answer = await send('POST', '/auth/login', { dpop: key.createProof('POST', urlOf('/auth/register')) }, {
            email: await createUser('wrong-route'),
            password
        });

        expect(answer.status).toBe(400);
        expect(answer.body).toMatchObject({ error: 'invalid_dpop_proof' });
    });
});

describe('JwtAuthStrategy — logins that have to be bound to a DPoP key', () => {
    beforeAll(async () => {
        server = await startApp(bindingLogins(true, false));
        baseUrl = await server.start();
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('refuses a login without a proof, and binds one with', async () => {
        const email: string = await createUser('required');

        const refused: Answer = await login(email, undefined);
        expect(refused.status).toBe(400);
        expect(refused.body).toMatchObject({ error: 'invalid_dpop_proof' });

        const key: FakeDpopKey = new FakeDpopKey();
        const tokens: Tokens = tokensOf(await login(email, key));
        expect((await callBound(tokens.accessToken, key)).status).toBe(200);
    });
});

describe('JwtAuthStrategy — DPoP proofs that carry a nonce', () => {
    beforeAll(async () => {
        server = await startApp(bindingLogins(false, true));
        baseUrl = await server.start();
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('answers a proof without a nonce with one, and takes the proof carrying it', async () => {
        const email: string = await createUser('nonce');
        const key: FakeDpopKey = new FakeDpopKey();

        const asked: Answer = await login(email, key);
        expect(asked.status).toBe(400);
        expect(asked.body).toMatchObject({ error: 'use_dpop_nonce' });
        const nonce: string | null = asked.headers.get('dpop-nonce');
        expect(nonce).toEqual(expect.any(String));

        const proof: string = key.createProof('POST', urlOf('/auth/login'), { nonce: nonce ?? '' });
        const tokens: Tokens = tokensOf(await send('POST', '/auth/login', { dpop: proof }, { email, password }));

        // a resource asks the same way, challenging with the scheme
        const challenged: Answer = await callBound(tokens.accessToken, key);
        expect(challenged.status).toBe(401);
        expect(challenged.headers.get('www-authenticate')).toMatch(/^DPoP error="use_dpop_nonce"/);
        const resourceNonce: string = challenged.headers.get('dpop-nonce') ?? '';
        const answered: Answer = await send('GET', '/dpop-test/me', {
            authorization: `DPoP ${tokens.accessToken}`,
            dpop: key.createProof('GET', urlOf('/dpop-test/me'), { accessToken: tokens.accessToken, nonce: resourceNonce })
        });
        expect(answered.status).toBe(200);
    });

    it('refuses a nonce the application did not issue', async () => {
        const key: FakeDpopKey = new FakeDpopKey();
        const proof: string = key.createProof('POST', urlOf('/auth/login'), { nonce: 'made-up' });

        const answer: Answer = await send('POST', '/auth/login', { dpop: proof }, { email: await createUser('made-up-nonce'), password });

        expect(answer.status).toBe(400);
        expect(answer.body).toMatchObject({ error: 'use_dpop_nonce' });
    });
});