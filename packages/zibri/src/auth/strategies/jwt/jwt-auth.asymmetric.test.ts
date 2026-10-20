import assert from 'node:assert';
import { createPublicKey, createSecretKey, generateKeyPairSync, JsonWebKeyInput, KeyObject } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeProtectedHeader, jwtVerify, ProtectedHeaderParameters, SignJWT } from 'jose';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { JwksController } from './jwks.controller.ts';
import { JwtAsymmetricKey } from './jwt-asymmetric-key.model.ts';
import { JwtAuthOptionsInput } from './jwt-auth-options.model.ts';
import { JwtAuthStrategy } from './jwt.auth-strategy.ts';
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
 * Something to present an access token to. Allowed to go undeclared, because the applications that
 * are refused a key never get as far as serving it.
 */
@Controller('/jwt-test', { allowOrphan: true })
class JwtProtectedController {
    @Get('/me')
    @Auth.isLoggedIn([JwtAuthStrategy])
    me(): { ok: boolean } {
        return { ok: true };
    }
}

/**
 * A published key as a verifier reads it.
 */
type PublishedKey = JsonWebKeyInput['key'] & {
    kid: string,
    alg: string,
    use: string
};

type JwksBody = {
    keys: PublishedKey[]
};

type KeyPair = {
    publicKey: KeyObject,
    privateKey: KeyObject
};

type LoginBody = {
    userId: string,
    accessToken: { value: string }
};

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: defaultTestServerEntities });

const email: string = 'asymmetric@example.com';
const password: string = 'secure123';

/**
 * The providers of an application whose access tokens are signed with the given key.
 * @param accessTokenKey - What access tokens are signed with.
 * @param previousAccessTokenKeys - What they still verify against.
 * @returns The providers, the test server's own with the jwt options replaced.
 */
function signingWith(
    accessTokenKey: string | JwtAsymmetricKey,
    previousAccessTokenKeys: (string | JwtAsymmetricKey)[] = []
): DiProvider<unknown>[] {
    return [
        ...defaultTestServerProviders,
        defineProvider({
            token: ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT,
            useFactory: (): JwtAuthOptionsInput => ({
                accessTokenKey,
                previousAccessTokenKeys,
                refreshTokenSecret: 'test-refresh-token-secret'
            })
        })
    ];
}

function generateEcKeyPair(namedCurve: string = 'P-256'): KeyPair {
    return generateKeyPairSync('ec', { namedCurve });
}

function decodeHeader(token: string): ProtectedHeaderParameters {
    return decodeProtectedHeader(token);
}

/**
 * What another service does with a token: checks it against a key it holds, and nothing else.
 * @param token - The token to check.
 * @param key - The key the service holds.
 * @param algorithm - The one algorithm the service accepts.
 * @returns Whether the token verifies.
 */
async function verifiesWith(token: string, key: KeyObject, algorithm: string): Promise<boolean> {
    try {
        await jwtVerify(token, key, { algorithms: [algorithm] });
        return true;
    }
    catch {
        return false;
    }
}

/**
 * Signs an access token as somebody other than the application.
 *
 * Everything but the signature is what the application itself would sign - a real user, every claim
 * an access token carries - so that a refusal can only come from the signature.
 * @param userId - The user the token names.
 * @param key - What to sign with.
 * @param algorithm - The algorithm to name in the header.
 * @param kid - The key id to name in the header.
 * @returns The token.
 */
async function forge(userId: string, key: KeyObject, algorithm: string, kid: string | undefined): Promise<string> {
    const issuer: string = GlobalRegistry.getAppData('baseUrl') ?? '';
    return await new SignJWT({ id: userId, email, roles: [Roles.USER], auth_time: Math.floor(Date.now() / 1000), sid: 'login' })
        .setProtectedHeader({ alg: algorithm, kid, typ: 'at+jwt' })
        .setIssuedAt()
        .setIssuer(issuer)
        .setAudience(issuer)
        .setExpirationTime('1h')
        .sign(key);
}

async function login(baseUrl: string): Promise<LoginBody> {
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JsonUtilities.stringify({ email, password })
    });
    expect(res.status).toBe(200);
    // eslint-disable-next-line typescript/no-unsafe-return
    return await res.json();
}

async function callMeWith(baseUrl: string, token: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/jwt-test/me`, { headers: { Authorization: `Bearer ${token}` } });
    return res.status;
}

async function fetchJwks(baseUrl: string): Promise<JwksBody> {
    const res: Response = await fetch(`${baseUrl}/.well-known/jwks.json`);
    expect(res.status).toBe(200);
    // eslint-disable-next-line typescript/no-unsafe-return
    return await res.json();
}

/**
 * Creates the user every test logs in as, unless an earlier server on the same store already did.
 * @returns The id of the user.
 */
async function seedUser(): Promise<string> {
    const userRepo: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
    const credentialsRepo: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    // the in memory store belongs to the data source class, so it outlives each server
    const existing: JwtUser | undefined = await userRepo.findOne({ where: { email }, required: false });
    if (existing) {
        return existing.id;
    }
    const user: JwtUser = await userRepo.create({ email, roles: [Roles.USER] });
    await credentialsRepo.create({ password, userId: user.id });
    return user.id;
}

describe('JwtAuthStrategy — access tokens signed with a key pair', () => {
    const current: KeyPair = generateEcKeyPair();
    let server: StartedTestServer;
    let baseUrl: string;
    let userId: string;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            controllers: [JwtTestAuthController, JwksController, JwtProtectedController],
            providers: signingWith({ algorithm: 'ES256', key: current.privateKey })
        });
        baseUrl = await server.start();
        userId = await seedUser();
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('signs an access token that a verifier holding only the public key accepts', async () => {
        const { accessToken } = await login(baseUrl);

        expect(decodeHeader(accessToken.value)).toEqual(expect.objectContaining({ alg: 'ES256', kid: expect.any(String) }));
        expect(await verifiesWith(accessToken.value, current.publicKey, 'ES256')).toBe(true);
        expect(await callMeWith(baseUrl, accessToken.value)).toBe(200);
    });

    it('publishes the public key, and nothing else of it, for a verifier to find by kid', async () => {
        const { accessToken } = await login(baseUrl);
        const { keys } = await fetchJwks(baseUrl);

        expect(keys).toHaveLength(1);
        const [published] = keys;
        assert(published, 'no key was published');
        expect(published).toEqual(expect.objectContaining({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: decodeHeader(accessToken.value).kid }));
        // `d` is the private scalar - publishing it would hand out the signing key
        expect(published).not.toHaveProperty('d');

        // a verifier that was handed nothing but the url
        const fromJwks: KeyObject = createPublicKey({ key: published, format: 'jwk' });
        expect(await verifiesWith(accessToken.value, fromJwks, 'ES256')).toBe(true);
    });

    it('accepts a token forged with its own key, which is what makes the forgeries below mean something', async () => {
        // the forgeries below are refused for their signature only if everything else about them
        // would pass. This is that everything else, signed with the one key that should pass
        const genuine: string = await forge(userId, current.privateKey, 'ES256', decodeHeader((await login(baseUrl)).accessToken.value).kid);
        expect(await callMeWith(baseUrl, genuine)).toBe(200);
    });

    it('refuses a token signed with hmac over the public key, even when it names the key', async () => {
        // the classic confusion: the public key is public, so anyone can compute an hmac with it.
        // A verifier that let the token choose the algorithm would check that hmac against the
        // very key it was made with. Naming the real kid makes sure it is the key pair's check
        // that refuses it, rather than there being no key to check it against
        const publicPem: string = current.publicKey.export({ type: 'spki', format: 'pem' }).toString();
        const forged: string = await forge(userId, createSecretKey(Buffer.from(publicPem)), 'HS256', decodeHeader((await login(baseUrl)).accessToken.value).kid);

        expect(await callMeWith(baseUrl, forged)).toBe(401);
    });

    it('refuses a token signed with a key it does not know, even when it names one it does', async () => {
        const stranger: KeyPair = generateEcKeyPair();
        const forged: string = await forge(userId, stranger.privateKey, 'ES256', decodeHeader((await login(baseUrl)).accessToken.value).kid);

        expect(await callMeWith(baseUrl, forged)).toBe(401);
    });

    it('refuses a refresh token presented as an access token', async () => {
        const res: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({ email, password })
        });
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { refreshToken: { value: string } } = await res.json();

        expect(await callMeWith(baseUrl, body.refreshToken.value)).toBe(401);
    });

    it('keeps accepting tokens signed with a previous key, and publishes it after the current one', async () => {
        const { accessToken: before } = await login(baseUrl);
        const next: KeyPair = generateEcKeyPair('P-384');

        // the rotation: a new key signs, the old one only verifies - so its public half is enough
        await server.reInit({
            providers: signingWith({ algorithm: 'ES384', key: next.privateKey }, [{ algorithm: 'ES256', key: current.publicKey }])
        });
        baseUrl = await server.start();

        expect(await callMeWith(baseUrl, before.value)).toBe(200);
        const { accessToken: after } = await login(baseUrl);
        expect(decodeHeader(after.value).alg).toBe('ES384');
        expect(await callMeWith(baseUrl, after.value)).toBe(200);

        const { keys } = await fetchJwks(baseUrl);
        expect(keys.map(k => k.kid)).toEqual([decodeHeader(after.value).kid, decodeHeader(before.value).kid]);
    });
});

describe('JwtAuthStrategy — an RSA key pair', () => {
    it('signs with RS256 for verifiers that accept nothing else', async () => {
        const rsa: KeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const server: StartedTestServer = await startTestServer({
            dataSources: [dataSourceClass],
            controllers: [JwtTestAuthController, JwtProtectedController],
            providers: signingWith({ algorithm: 'RS256', key: rsa.privateKey })
        });
        try {
            const baseUrl: string = await server.start();
            await seedUser();
            const { accessToken } = await login(baseUrl);

            expect(decodeHeader(accessToken.value).alg).toBe('RS256');
            expect(await verifiesWith(accessToken.value, rsa.publicKey, 'RS256')).toBe(true);
            expect(await callMeWith(baseUrl, accessToken.value)).toBe(200);
        }
        finally {
            await server.shutdown();
        }
    }, 20000);
});

describe('JwtAuthStrategy — an Ed25519 key pair', () => {
    it('signs with EdDSA, and publishes the key for a verifier to find by kid', async () => {
        const ed25519: KeyPair = generateKeyPairSync('ed25519');
        const server: StartedTestServer = await startTestServer({
            dataSources: [dataSourceClass],
            controllers: [JwtTestAuthController, JwksController, JwtProtectedController],
            providers: signingWith({ algorithm: 'EdDSA', key: ed25519.privateKey })
        });
        try {
            const baseUrl: string = await server.start();
            await seedUser();
            const { accessToken } = await login(baseUrl);

            expect(decodeHeader(accessToken.value).alg).toBe('EdDSA');
            expect(await verifiesWith(accessToken.value, ed25519.publicKey, 'EdDSA')).toBe(true);
            expect(await callMeWith(baseUrl, accessToken.value)).toBe(200);

            const { keys } = await fetchJwks(baseUrl);
            const [published] = keys;
            assert(published, 'no key was published');
            expect(published).toEqual(expect.objectContaining({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', kid: decodeHeader(accessToken.value).kid }));
            expect(published).not.toHaveProperty('d');
            const fromJwks: KeyObject = createPublicKey({ key: published, format: 'jwk' });
            expect(await verifiesWith(accessToken.value, fromJwks, 'EdDSA')).toBe(true);
        }
        finally {
            await server.shutdown();
        }
    }, 20000);
});

describe('JwtAuthStrategy — refuses to start with a key it cannot use', () => {
    const ec: KeyPair = generateEcKeyPair();

    async function startSigningWith(
        accessTokenKey: string | JwtAsymmetricKey,
        previousAccessTokenKeys: (string | JwtAsymmetricKey)[] = [],
        controllers: Newable<unknown>[] = [JwtTestAuthController]
    ): Promise<void> {
        const server: StartedTestServer = await startTestServer({
            dataSources: [dataSourceClass],
            controllers,
            providers: signingWith(accessTokenKey, previousAccessTokenKeys)
        });
        // only reached when the boot did not refuse, which is the failure being tested for
        await server.shutdown();
    }

    it('a public key to sign with', async () => {
        await expect(startSigningWith({ algorithm: 'ES256', key: ec.publicKey })).rejects.toThrow(/has to be a private key/);
    });

    it('a key on the wrong curve for its algorithm', async () => {
        await expect(startSigningWith({ algorithm: 'ES384', key: ec.privateKey })).rejects.toThrow(/curve secp384r1/);
    });

    it('a key of the wrong type for its algorithm', async () => {
        await expect(startSigningWith({ algorithm: 'RS256', key: ec.privateKey })).rejects.toThrow(/needs an rsa key/);
        await expect(startSigningWith({ algorithm: 'EdDSA', key: ec.privateKey })).rejects.toThrow(/needs an ed25519 key/);
    });

    it('an RSA key shorter than 2048 bits', async () => {
        const short: KeyPair = generateKeyPairSync('rsa', { modulusLength: 1024 });
        await expect(startSigningWith({ algorithm: 'RS256', key: short.privateKey })).rejects.toThrow(/at least 2048 bits/);
    });

    it('a previous key that does not fit its algorithm', async () => {
        // found here rather than when the first token it signed stops verifying, which would log
        // everybody out at once
        await expect(startSigningWith(
            { algorithm: 'ES256', key: ec.privateKey },
            [{ algorithm: 'ES512', key: generateEcKeyPair().publicKey }]
        )).rejects.toThrow(/previousAccessTokenKeys/);
    });

    it('the current key repeated as a previous one', async () => {
        // configured once as the private half and once as the public half, which is still one key
        await expect(startSigningWith(
            { algorithm: 'ES256', key: ec.privateKey },
            [{ algorithm: 'ES256', key: ec.publicKey }]
        )).rejects.toThrow(/not all distinct/);
    });

    it('a key set to publish when every key is a shared secret', async () => {
        await expect(startSigningWith('test-access-token-secret', [], [JwtTestAuthController, JwksController]))
            .rejects.toThrow(/no access token key is a key pair/);
    });
});