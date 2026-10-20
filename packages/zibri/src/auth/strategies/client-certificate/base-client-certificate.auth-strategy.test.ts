import { X509Certificate } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeKeyPair, createInMemoryDataSource, FakeKeyPair, FakeKeyPairOptions, InMemoryDataSource } from 'zibri-testing';

import { BaseClientCertificateAuthStrategy } from './base-client-certificate.auth-strategy.ts';
import { ClientCertificateHeaderFormat } from './client-certificate-header-format.type.ts';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { Controller } from '../../../routing/decorators/controller.decorator.ts';
import { Get } from '../../../routing/decorators/get.decorator.ts';
import { Newable } from '../../../types/newable.type.ts';
import { type AuthServiceInterface } from '../../auth-service.interface.ts';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../authenticators/password/password-credentials.model.ts';
import { PasswordAuthenticator } from '../../authenticators/password/password.authenticator.ts';
import { Auth } from '../../decorators/auth.decorator.ts';
import { CurrentUser } from '../../decorators/current-user.decorator.ts';
import { AuthStrategies } from '../auth-strategies.model.ts';
import { JwtAuthData } from '../jwt/jwt-auth-data.model.ts';
import { JwtAuthStrategy } from '../jwt/jwt.auth-strategy.ts';

/**
 * What the route answering with the current user answers.
 */
type Me = {
    id: string,
    roles: Roles[]
};

@Controller('/client')
class ClientController {
    @Auth.isLoggedIn()
    @Get('/me')
    me(
        @CurrentUser()
        user: JwtUser
    ): Me {
        return { id: user.id, roles: user.roles };
    }

    // a route for people only, which a certificate cannot reach
    @Auth.isLoggedIn([JwtAuthStrategy])
    @Get('/people-only')
    peopleOnly(): { ok: boolean } {
        return { ok: true };
    }
}

/**
 * The authority client certificates are issued by, made before any application starts.
 */
let authority: FakeKeyPair;

/**
 * Takes the certificate from the proxy on this machine, which is where the test's requests come from,
 * and finds the user by the email address in its common name.
 */
class LocalProxyClientCertificateAuthStrategy extends BaseClientCertificateAuthStrategy<Roles, JwtUser> {
    readonly header: string = 'Client-Cert';
    readonly headerFormat: ClientCertificateHeaderFormat = 'rfc9440';
    readonly trustedProxies: string[] = ['127.0.0.1', '::1'];
    readonly certificateAuthorities: string[] = [authority.certificate];

    async resolveUserByCertificate(certificate: X509Certificate): Promise<JwtUser | undefined> {
        const email: string | undefined = /^CN=(.+)$/m.exec(certificate.subject)?.[1];
        if (email == undefined) {
            return undefined;
        }
        return await inject(repositoryTokenFor(JwtUser)).findOne({ where: { email }, required: false });
    }
}

/**
 * Takes the certificate from proxies of a network the test's requests do not come from.
 */
class OtherNetworkClientCertificateAuthStrategy extends LocalProxyClientCertificateAuthStrategy {
    override readonly trustedProxies: string[] = ['10.0.0.0/8', 'fd00::/8'];
}

/**
 * A value in base64 that is no certificate.
 */
const NOT_A_CERTIFICATE: string = Buffer.from('not a certificate').toString('base64');

class NoProxyClientCertificateAuthStrategy extends LocalProxyClientCertificateAuthStrategy {
    override readonly trustedProxies: string[] = [];
}

class WrongProxyClientCertificateAuthStrategy extends LocalProxyClientCertificateAuthStrategy {
    override readonly trustedProxies: string[] = ['127.0.0.1', '10.0.0.0/33'];
}

class NoAuthorityClientCertificateAuthStrategy extends LocalProxyClientCertificateAuthStrategy {
    override readonly certificateAuthorities: string[] = [];
}

class WrongAuthorityClientCertificateAuthStrategy extends LocalProxyClientCertificateAuthStrategy {
    override readonly certificateAuthorities: string[] = [`-----BEGIN CERTIFICATE-----\n${NOT_A_CERTIFICATE}\n-----END CERTIFICATE-----`];
}

class NoHeaderClientCertificateAuthStrategy extends LocalProxyClientCertificateAuthStrategy {
    override readonly header: string = ' ';
}

/**
 * The extended key usage of TLS client authentication.
 */
const CLIENT_AUTH: string = '1.3.6.1.5.5.7.3.2';

/**
 * The extended key usage of TLS server authentication.
 */
const SERVER_AUTH: string = '1.3.6.1.5.5.7.3.1';

/**
 * An extended key usage the test's own authority defines.
 */
const OWN_USAGE: string = '1.3.6.1.4.1.55555.1';

class OwnUsageClientCertificateAuthStrategy extends LocalProxyClientCertificateAuthStrategy {
    override readonly requiredExtendedKeyUsages: string[] = [CLIENT_AUTH, OWN_USAGE];
}

class WrongUsageClientCertificateAuthStrategy extends LocalProxyClientCertificateAuthStrategy {
    override readonly requiredExtendedKeyUsages: string[] = ['client auth'];
}

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * Starts an application keeping its data in memory.
 * @param authStrategies - The strategies it reads requests with.
 * @returns The server, started.
 */
async function startApp(authStrategies: AuthStrategies): Promise<StartedTestServer> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: defaultTestServerEntities,
        allowOrphan: true
    });
    return await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies,
        controllers: [ClientController],
        providers: defaultTestServerProviders
    });
}

/**
 * Creates a user with the given roles.
 * @param name - What sets the user's email apart.
 * @returns The user.
 */
async function createUser(name: string): Promise<JwtUser> {
    const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
    return await users.create({ email: `${name}@clients.test`, roles: [Roles.USER] });
}

/**
 * Issues a client certificate to a user.
 * @param user - The user, whose email address is its common name.
 * @param options - Who signs it and when it is valid. The authority by default.
 * @returns The certificate.
 */
async function issueCertificate(user: JwtUser, options: FakeKeyPairOptions = { issuer: authority }): Promise<X509Certificate> {
    return new X509Certificate((await createFakeKeyPair(`CN=${user.email}`, options)).certificate);
}

/**
 * Logs a user in with a password and the jwt strategy.
 * @param user - The user.
 * @returns The access token.
 */
async function resolveAccessToken(user: JwtUser): Promise<string> {
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    await credentials.create({ userId: user.id, password: 'correct horse battery staple' });
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const authData: JwtAuthData<Roles> = await authService.login(
        PasswordAuthenticator<Roles>,
        JwtAuthStrategy<Roles>,
        { email: user.email, password: 'correct horse battery staple' },
        undefined
    );
    return authData.accessToken.value;
}

/**
 * Calls a route of the client controller the way the proxy forwards a request.
 * @param path - The route below /client.
 * @param headers - The headers the proxy forwards.
 * @returns The answer.
 */
async function call(path: string, headers: Record<string, string>): Promise<Response> {
    return await fetch(`${baseUrl}/client${path}`, { headers });
}

/**
 * The header the proxy forwards a certificate in.
 * @param certificate - The certificate.
 * @returns The header, as RFC 9440 writes it.
 */
function certificateHeader(certificate: X509Certificate): Record<string, string> {
    return { 'client-cert': `:${certificate.raw.toString('base64')}:` };
}

beforeAll(async () => {
    authority = await createFakeKeyPair('CN=Client test authority', { authority: true });
});

describe('BaseClientCertificateAuthStrategy — starting', () => {
    it.each([
        [NoProxyClientCertificateAuthStrategy, 'names no proxy to take the certificate from'],
        [WrongProxyClientCertificateAuthStrategy, 'The trusted proxy "10.0.0.0/33"'],
        [NoAuthorityClientCertificateAuthStrategy, 'names no authority that issues client certificates'],
        [WrongAuthorityClientCertificateAuthStrategy, 'is not a PEM encoded certificate'],
        [NoHeaderClientCertificateAuthStrategy, 'names no header the proxy forwards the certificate in'],
        [WrongUsageClientCertificateAuthStrategy, 'The extended key usage "client auth" of WrongUsageClientCertificateAuthStrategy is no object identifier']
    ])('refuses to start %p', async (strategy, message) => {
        await expect(startApp([JwtAuthStrategy, strategy])).rejects.toThrow(message);
    }, 30000);
});

describe('BaseClientCertificateAuthStrategy', () => {
    beforeAll(async () => {
        server = await startApp([JwtAuthStrategy, LocalProxyClientCertificateAuthStrategy]);
        baseUrl = await server.start();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('lets a request act as the user its certificate belongs to', async () => {
        const user: JwtUser = await createUser('anna');

        const res: Response = await call('/me', certificateHeader(await issueCertificate(user)));

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: user.id, roles: [Roles.USER] });
    });

    it('refuses a certificate that no authority of it issued, though it names a user', async () => {
        const user: JwtUser = await createUser('bob');
        const otherAuthority: FakeKeyPair = await createFakeKeyPair('CN=Client test authority', { authority: true });

        expect((await call('/me', certificateHeader(await issueCertificate(user, {})))).status).toBe(401);
        expect((await call('/me', certificateHeader(await issueCertificate(user, { issuer: otherAuthority })))).status).toBe(401);
    });

    it('refuses a certificate before and after it is valid', async () => {
        const user: JwtUser = await createUser('carla');
        const hour: number = 3_600_000;

        const notYet: X509Certificate = await issueCertificate(
            user,
            { issuer: authority, notBefore: new Date(Date.now() + hour), notAfter: new Date(Date.now() + (2 * hour)) }
        );
        const expired: X509Certificate = await issueCertificate(
            user,
            { issuer: authority, notBefore: new Date(Date.now() - (2 * hour)), notAfter: new Date(Date.now() - hour) }
        );

        expect((await call('/me', certificateHeader(notYet))).status).toBe(401);
        expect((await call('/me', certificateHeader(expired))).status).toBe(401);
    });

    it('refuses a certificate issued for a server, or for any usage without naming the client\'s', async () => {
        const user: JwtUser = await createUser('kim');

        const forServer: X509Certificate = await issueCertificate(user, { issuer: authority, extendedKeyUsages: [SERVER_AUTH] });
        // anyExtendedKeyUsage, which a proxy checking the usage refuses too
        const forAnything: X509Certificate = await issueCertificate(user, { issuer: authority, extendedKeyUsages: ['2.5.29.37.0'] });
        const forBoth: X509Certificate = await issueCertificate(user, { issuer: authority, extendedKeyUsages: [SERVER_AUTH, CLIENT_AUTH] });

        expect((await call('/me', certificateHeader(forServer))).status).toBe(401);
        expect((await call('/me', certificateHeader(forAnything))).status).toBe(401);
        expect((await call('/me', certificateHeader(forBoth))).status).toBe(200);
    });

    it('refuses a certificate whose key may neither sign nor agree on a key', async () => {
        const user: JwtUser = await createUser('lars');

        const forEncrypting: X509Certificate = await issueCertificate(user, { issuer: authority, keyUsages: ['keyEncipherment'] });
        const forSigning: X509Certificate = await issueCertificate(user, { issuer: authority, keyUsages: ['digitalSignature', 'keyEncipherment'] });
        const forAgreeing: X509Certificate = await issueCertificate(user, { issuer: authority, keyUsages: ['keyAgreement'] });

        expect((await call('/me', certificateHeader(forEncrypting))).status).toBe(401);
        expect((await call('/me', certificateHeader(forSigning))).status).toBe(200);
        expect((await call('/me', certificateHeader(forAgreeing))).status).toBe(200);
    });

    it('refuses a certificate whose user is not found', async () => {
        const user: JwtUser = await createUser('dave');
        const certificate: X509Certificate = await issueCertificate(user);
        await inject(repositoryTokenFor(JwtUser)).deleteById(user.id);

        expect((await call('/me', certificateHeader(certificate))).status).toBe(401);
    });

    it('refuses a header that holds no certificate', async () => {
        expect((await call('/me', { 'client-cert': `:${NOT_A_CERTIFICATE}:` })).status).toBe(401);
    });

    it('takes an empty header for none, and the request\'s bearer token instead', async () => {
        const user: JwtUser = await createUser('erin');

        const res: Response = await call('/me', { 'client-cert': '', authorization: `Bearer ${await resolveAccessToken(user)}` });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: user.id, roles: [Roles.USER] });
    });

    it('refuses a request with a certificate and a bearer token', async () => {
        const user: JwtUser = await createUser('frank');
        const other: JwtUser = await createUser('gina');

        const res: Response = await call(
            '/me',
            { ...certificateHeader(await issueCertificate(user)), authorization: `Bearer ${await resolveAccessToken(other)}` }
        );

        expect(res.status).toBe(401);
    });

    it('cannot reach a route that accepts other strategies only', async () => {
        const user: JwtUser = await createUser('hank');

        expect((await call('/people-only', certificateHeader(await issueCertificate(user)))).status).toBe(401);
    });

    it('is described in the api explorer as mutual TLS', async () => {
        const spec: unknown = await (await fetch(`${baseUrl}/explorer/spec/1.0.0`)).json();

        expect(spec).toMatchObject({
            components: { securitySchemes: { 'client-certificate': { type: 'mutualTLS', description: expect.any(String) } } }
        });
    });
});

describe('BaseClientCertificateAuthStrategy — extended key usages of its own', () => {
    beforeAll(async () => {
        server = await startApp([JwtAuthStrategy, OwnUsageClientCertificateAuthStrategy]);
        baseUrl = await server.start();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('takes a certificate naming every one of them, or no extended key usage at all', async () => {
        const user: JwtUser = await createUser('mia');

        const clientOnly: X509Certificate = await issueCertificate(user, { issuer: authority, extendedKeyUsages: [CLIENT_AUTH] });
        const both: X509Certificate = await issueCertificate(user, { issuer: authority, extendedKeyUsages: [CLIENT_AUTH, OWN_USAGE] });
        const unrestricted: X509Certificate = await issueCertificate(user);

        expect((await call('/me', certificateHeader(clientOnly))).status).toBe(401);
        expect((await call('/me', certificateHeader(both))).status).toBe(200);
        expect((await call('/me', certificateHeader(unrestricted))).status).toBe(200);
    });
});

describe('BaseClientCertificateAuthStrategy — a request that does not come from a trusted proxy', () => {
    beforeAll(async () => {
        server = await startApp([JwtAuthStrategy, OtherNetworkClientCertificateAuthStrategy]);
        baseUrl = await server.start();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('has its certificate ignored', async () => {
        const user: JwtUser = await createUser('ivy');
        const other: JwtUser = await createUser('jack');
        const certificate: Record<string, string> = certificateHeader(await issueCertificate(user));

        expect((await call('/me', certificate)).status).toBe(401);
        // ignored, not refused: the bearer token of the request is the only credential it has
        const res: Response = await call('/me', { ...certificate, authorization: `Bearer ${await resolveAccessToken(other)}` });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: other.id, roles: [Roles.USER] });
    });
});