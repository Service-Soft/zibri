import { X509Certificate } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { request, RequestOptions } from 'node:https';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { TestContainers } from 'testcontainers';
import { createFakeKeyPair, createInMemoryDataSource, FakeKeyPair, InMemoryDataSource } from 'zibri-testing';

import { BaseClientCertificateAuthStrategy } from './base-client-certificate.auth-strategy';
import { ClientCertificateHeaderFormat } from './client-certificate-header-format.type';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../di/inject.function';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { Newable } from '../../../types/newable.type';
import { Auth } from '../../decorators/auth.decorator';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { JwtAuthStrategy } from '../jwt/jwt.auth-strategy';

/**
 * What a proxy in front of the application is started with.
 */
export type ClientCertificateProxyStartOptions = {
    /**
     * The port the application listens on, on this machine, which the proxy reaches as
     * `host.testcontainers.internal`.
     */
    applicationPort: number,
    /**
     * The key and certificate the proxy proves who it is with, valid for `localhost`.
     */
    proxyKeyPair: FakeKeyPair,
    /**
     * The authority client certificates are issued by.
     */
    authority: FakeKeyPair
};

/**
 * A proxy in front of the application, once it runs.
 */
export type StartedClientCertificateProxy = {
    /**
     * Where the proxy is reached from this machine.
     */
    host: string,
    /**
     * The port on this machine that checks the issuer of a client certificate, as a proxy in front of
     * an api should.
     */
    verifyingPort: number,
    /**
     * The port on this machine that takes any client certificate, which only proves that the client
     * holds its key.
     */
    anyCertificatePort: number,
    /**
     * Stops the proxy.
     */
    stop: () => Promise<void>
};

/**
 * A proxy that ends TLS in front of the application and forwards the client certificate.
 */
export type ClientCertificateProxy = {
    /**
     * The header it forwards the certificate in.
     */
    header: string,
    /**
     * How it writes the certificate into the header.
     */
    headerFormat: ClientCertificateHeaderFormat,
    /**
     * Writes a certificate into the header the way the proxy does, as a client forging it would.
     */
    forgeHeaderValue: (certificate: string) => string,
    /**
     * Starts the proxy in front of the application.
     */
    start: (options: ClientCertificateProxyStartOptions) => Promise<StartedClientCertificateProxy>
};

/**
 * What the route answering with the current user answers.
 */
type Me = {
    /**
     * The id of the user.
     */
    id: string,
    /**
     * The roles the request holds.
     */
    roles: Roles[]
};

/**
 * What the proxy answered.
 */
type ProxyAnswer = {
    /**
     * The http status.
     */
    status: number,
    /**
     * The body, as text.
     */
    body: string
};

/**
 * A user, and a key and certificate for them.
 */
type Client = {
    /**
     * The user.
     */
    user: JwtUser,
    /**
     * The key and certificate the user's client shows.
     */
    keyPair: FakeKeyPair
};

/**
 * Answers with the current user.
 */
@Controller('/client')
class ClientController {
    /**
     * The current user.
     * @param user - The user of the request.
     * @returns Their id and roles.
     */
    @Auth.isLoggedIn()
    @Get('/me')
    me(
        @CurrentUser()
        user: JwtUser
    ): Me {
        return { id: user.id, roles: user.roles };
    }
}

/**
 * Tests the client certificate strategy behind a real proxy: the handshake, the header as the proxy
 * really writes it, and the proxy's part in keeping a forged header out.
 * @param proxyName - The name of the proxy, for the suite's name.
 * @param proxy - How to start it, and how it forwards the certificate.
 */
export function describeBehindProxy(proxyName: string, proxy: ClientCertificateProxy): void {
    describe(`BaseClientCertificateAuthStrategy — behind ${proxyName}`, () => {
        let authority: FakeKeyPair;
        let proxyKeyPair: FakeKeyPair;
        let server: StartedTestServer;
        let started: StartedClientCertificateProxy;

        /**
         * Takes the certificate from the proxy, whose connections arrive from this machine through the
         * tunnel testcontainers opens to it, and finds the user by the email address in its common name.
         */
        class ProxyClientCertificateAuthStrategy extends BaseClientCertificateAuthStrategy<Roles, JwtUser> {
            // eslint-disable-next-line jsdoc/require-jsdoc
            readonly header: string = proxy.header;
            // eslint-disable-next-line jsdoc/require-jsdoc
            readonly headerFormat: ClientCertificateHeaderFormat = proxy.headerFormat;
            // eslint-disable-next-line jsdoc/require-jsdoc
            readonly trustedProxies: string[] = ['127.0.0.1', '::1'];
            // eslint-disable-next-line jsdoc/require-jsdoc
            readonly certificateAuthorities: string[] = [authority.certificate];

            // eslint-disable-next-line jsdoc/require-jsdoc
            async resolveUserByCertificate(certificate: X509Certificate): Promise<JwtUser | undefined> {
                const email: string | undefined = /^CN=(.+)$/m.exec(certificate.subject)?.[1];
                if (email == undefined) {
                    return undefined;
                }
                return await inject(repositoryTokenFor(JwtUser)).findOne({ where: { email }, required: false });
            }
        }

        /**
         * Calls a route of the client controller through the proxy.
         * @param port - The port of the proxy on this machine.
         * @param path - The route below /client.
         * @param client - The key and certificate the client shows, if any.
         * @param headers - The headers the client sends.
         * @returns The answer.
         */
        async function callThroughProxy(
            port: number,
            path: string,
            client: FakeKeyPair | undefined,
            headers: Record<string, string> = {}
        ): Promise<ProxyAnswer> {
            const options: RequestOptions = {
                host: started.host,
                port,
                path: `/client${path}`,
                headers,
                servername: 'localhost',
                ca: proxyKeyPair.certificate,
                ...client == undefined ? {} : { cert: client.certificate, key: client.privateKey }
            };
            return await new Promise<ProxyAnswer>((resolve, reject) => {
                const req: ReturnType<typeof request> = request(options, (res: IncomingMessage) => {
                    let body: string = '';
                    res.setEncoding('utf8');
                    res.on('data', (chunk: string) => body += chunk);
                    res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
                });
                req.on('error', reject);
                req.end();
            });
        }

        /**
         * Creates a user, and a key and certificate for them. The certificate names an organization
         * after the common name, so a proxy that writes the subject writes a comma in it.
         * @param name - What sets the user's email apart.
         * @param issuer - Who signs the certificate. Self signed, when undefined.
         * @returns The user and their key pair.
         */
        async function createClient(name: string, issuer: FakeKeyPair | undefined): Promise<Client> {
            const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
            const user: JwtUser = await users.create({ email: `${name}@clients.test`, roles: [Roles.USER] });
            const keyPair: FakeKeyPair = await createFakeKeyPair(`CN=${user.email}, O=Clients`, issuer == undefined ? {} : { issuer });
            return { user, keyPair };
        }

        beforeAll(async () => {
            authority = await createFakeKeyPair('CN=Client test authority', { authority: true });
            proxyKeyPair = await createFakeKeyPair('CN=localhost', { hosts: ['localhost', '127.0.0.1'] });

            const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
                entities: defaultTestServerEntities,
                allowOrphan: true
            });
            server = await startTestServer({
                dataSources: [dataSourceClass],
                authStrategies: [JwtAuthStrategy, ProxyClientCertificateAuthStrategy],
                controllers: [ClientController],
                providers: defaultTestServerProviders
            });
            const applicationPort: number = Number(new URL(await server.start()).port);

            // before the proxy starts, which is when its container is given the name of this machine
            await TestContainers.exposeHostPorts(applicationPort);
            started = await proxy.start({ applicationPort, proxyKeyPair, authority });
        }, 120000);

        afterAll(async () => {
            await started.stop();
            await server.shutdown();
        }, 30000);

        it('lets a client in as the user of the certificate it showed', async () => {
            const { user, keyPair }: Client = await createClient('anna', authority);

            const answer: ProxyAnswer = await callThroughProxy(started.verifyingPort, '/me', keyPair);

            expect(answer.status).toBe(200);
            expect(JSON.parse(answer.body)).toEqual({ id: user.id, roles: [Roles.USER] });
        });

        it('never forwards a certificate header the client sent itself', async () => {
            const { keyPair }: Client = await createClient('bob', authority);

            // a certificate is public, so anybody can send one. Straight to the application, from this
            // machine, this header would be believed
            const answer: ProxyAnswer = await callThroughProxy(
                started.verifyingPort,
                '/me',
                undefined,
                { [proxy.header]: proxy.forgeHeaderValue(keyPair.certificate) }
            );

            expect(answer.status).toBe(401);
        });

        it('refuses a certificate the proxy took without checking its issuer', async () => {
            const issued: Client = await createClient('carla', authority);
            const selfSigned: Client = await createClient('dave', undefined);

            // the port forwards certificates, so the refusal below is the application's
            expect((await callThroughProxy(started.anyCertificatePort, '/me', issued.keyPair)).status).toBe(200);
            expect((await callThroughProxy(started.anyCertificatePort, '/me', selfSigned.keyPair)).status).toBe(401);
        });
    });
}