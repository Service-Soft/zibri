import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { createFakeKeyPair, createInMemoryDataSource, FakeKeyPair, InMemoryDataSource } from 'zibri-testing';

import { BaseActiveDirectoryAuthenticator } from './base-active-directory.authenticator.ts';
import { ContainerOutput } from '../../../../__testing__/container-output.model.ts';
import { JwtUser } from '../../../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../../../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../../../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../../../data-source/repository/repository.ts';
import { Transaction } from '../../../../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../../di/inject.function.ts';
import { KnownHeader } from '../../../../http/known-header.enum.ts';
import { MimeType } from '../../../../http/mime-type.enum.ts';
import { Body } from '../../../../routing/decorators/body.decorator.ts';
import { Controller } from '../../../../routing/decorators/controller.decorator.ts';
import { Param } from '../../../../routing/decorators/param.decorator.ts';
import { Post } from '../../../../routing/decorators/post.decorator.ts';
import { Newable } from '../../../../types/newable.type.ts';
import { JsonUtilities } from '../../../../utilities/json.utilities.ts';
import { AuthControllerUtilities } from '../../../auth-controller/auth-controller.utilities.ts';
import { Auth } from '../../../decorators/auth.decorator.ts';
import { JwtAuthData } from '../../../strategies/jwt/jwt-auth-data.model.ts';
import { JwtRefreshLoginDto } from '../../../strategies/jwt/jwt-refresh-login-data.model.ts';
import { JwtAuthStrategy } from '../../../strategies/jwt/jwt.auth-strategy.ts';
import { LdapCredentials } from '../ldap-credentials.model.ts';
import { LdapEntry } from '../ldap-entry.model.ts';
import { LdapIdentity } from '../ldap-identity.model.ts';
import { LdapServiceAccount } from '../ldap-service-account.model.ts';

// built from Debian's samba package, see the Dockerfile
const DOMAIN_CONTROLLER_IMAGE: string = 'zibri-test-samba-ad-dc';
const DOMAIN_CONTROLLER_CONTEXT: string = path.join(import.meta.dirname, '../../../../__testing__/containers/samba-ad-dc');
const DOMAIN: string = 'DC=zibri,DC=test';
const USERS: string = `CN=Users,${DOMAIN}`;
// passwords the domain's complexity rules take: long enough, mixed, and not containing the account name
const SERVICE_ACCOUNT: LdapServiceAccount = { dn: `CN=zibri-service,${USERS}`, password: 'Service-Account-1' };
const ANNA_PASSWORD: string = 'Correct-Horse-1';
const BOB_PASSWORD: string = 'Battery-Staple-2';
const CARLA_PASSWORD: string = 'Purple-Monkey-3';
const DAVE_PASSWORD: string = 'Ocean-Lantern-4';
const EVE_PASSWORD: string = 'Silver-Kettle-5';
const FRANK_PASSWORD: string = 'Granite-Harbor-6';

let container: StartedTestContainer;
let authority: FakeKeyPair;
let ldapUrl: string;
let ldapsUrl: string;

/**
 * Every entry the hook was handed, in order.
 */
const firstSignIns: LdapEntry[] = [];

abstract class TestDomain extends BaseActiveDirectoryAuthenticator<Roles, JwtUser> {
    // what the entrypoint provisions the domain as
    readonly netbiosName: string = 'ZIBRI';

    readonly serviceAccount: LdapServiceAccount = SERVICE_ACCOUNT;

    readonly searchBase: string = USERS;

    readonly groupSearchBase: string = DOMAIN;

    // read as the authenticator is built, which is once the key is made
    override readonly trustedCertificates: string[] = [authority.certificate];

    async resolveFirstSignIn(entry: LdapEntry, transaction: Transaction | undefined): Promise<JwtUser> {
        firstSignIns.push(entry);
        const [email] = entry.attributes['userprincipalname'] ?? [];
        return await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: email ?? '', roles: [Roles.USER] }, { transaction });
    }

    async resolveSignIn(entry: LdapEntry, user: JwtUser, transaction: Transaction | undefined): Promise<JwtUser> {
        const roles: Roles[] = entry.groups.some(dn => dn.toLowerCase() === `cn=admins,${USERS}`.toLowerCase()) ? [Roles.ADMIN] : [Roles.USER];
        return await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).updateById(user.id, { roles }, { transaction });
    }
}

class LdapsDomain extends TestDomain {
    readonly name: string = 'ldaps';

    get urls(): string[] {
        return [ldapsUrl];
    }
}

class StartTlsDomain extends TestDomain {
    readonly name: string = 'start-tls';

    get urls(): string[] {
        return [ldapUrl];
    }
}

const DOMAINS: Record<string, Newable<TestDomain>> = { ldaps: LdapsDomain, 'start-tls': StartTlsDomain };

@Auth.skip({ allowRedundant: true })
@Controller('/login-ad', { allowOrphan: true })
class ActiveDirectoryLoginController {
    @Post('/:domain')
    async login(
        @Param.path('domain')
        name: string,
        @Body(LdapCredentials)
        credentials: LdapCredentials
    ): Promise<JwtAuthData<string>> {
        const authenticator: Newable<TestDomain> | undefined = DOMAINS[name];
        if (authenticator == undefined) {
            throw new Error(`No domain is called ${name}.`);
        }
        return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).login(authenticator, JwtAuthStrategy, credentials, undefined);
    }

    // what the refresh route of AuthController does. Two parts, so that it is not taken for a domain
    @Post('/tokens/refresh')
    async refresh(
        @Body(JwtRefreshLoginDto)
        data: JwtRefreshLoginDto
    ): Promise<JwtAuthData<string>> {
        return await AuthControllerUtilities.runInTransaction(
            JwtAuthStrategy,
            async transaction => await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).refreshLogin(JwtAuthStrategy, { ...data, transaction })
        );
    }
}

let server: StartedTestServer;
let baseUrl: string;

/**
 * Refreshes a login through the refresh route.
 * @param refreshToken - The refresh token of the login.
 * @returns The answer.
 */
async function refresh(refreshToken: string): Promise<Response> {
    return await fetch(`${baseUrl}/login-ad/tokens/refresh`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify({ refreshToken })
    });
}

/**
 * What a successful sign-in or refresh answered.
 * @param res - The answer.
 * @returns The auth data.
 */
async function authDataOf(res: Response): Promise<JwtAuthData<string>> {
    expect(res.status).toBe(200);
    // eslint-disable-next-line typescript/no-unsafe-assignment
    const authData: JwtAuthData<string> = await res.json();
    return authData;
}

/**
 * Signs in through the login route of a domain.
 * @param credentials - What the user typed.
 * @param name - The domain.
 * @returns The answer.
 */
async function signIn(credentials: LdapCredentials, name: string = 'ldaps'): Promise<Response> {
    return await fetch(`${baseUrl}/login-ad/${name}`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify(credentials)
    });
}

/**
 * Runs samba-tool in the domain controller.
 * @param args - What to run it with.
 * @returns What it printed.
 */
async function sambaTool(...args: string[]): Promise<string> {
    const result: { exitCode: number, output: string } = await container.exec(['samba-tool', ...args]);
    if (result.exitCode !== 0) {
        throw new Error(`samba-tool ${args.join(' ')} failed: ${result.output}`);
    }
    return result.output;
}

describe('BaseActiveDirectoryAuthenticator against a Samba domain controller', () => {
    beforeAll(async () => {
        authority = await createFakeKeyPair('CN=Zibri test authority', { authority: true });
        const tlsKey: FakeKeyPair = await createFakeKeyPair('CN=localhost', { hosts: ['localhost', '127.0.0.1'], issuer: authority });
        const image: GenericContainer = await GenericContainer.fromDockerfile(DOMAIN_CONTROLLER_CONTEXT).build(DOMAIN_CONTROLLER_IMAGE, { deleteOnExit: false });
        const output: ContainerOutput = new ContainerOutput();
        try {
            container = await image
                .withEnvironment({ ADMIN_PASSWORD: 'Administrator-Secret-1' })
                .withCopyContentToContainer([
                    { content: tlsKey.certificate, target: '/tls/cert.pem', mode: 0o644 },
                    // samba refuses a key anybody else may read
                    { content: tlsKey.privateKey, target: '/tls/key.pem', mode: 0o600 },
                    { content: authority.certificate, target: '/tls/ca.pem', mode: 0o644 }
                ])
                // a domain controller keeps the access rules of its files in extended attributes, which
                // only a privileged container may write
                .withPrivilegedMode()
                .withExposedPorts(389, 636)
                .withLogConsumer(output.consume)
                .withWaitStrategy(Wait.forListeningPorts())
                .withStartupTimeout(180000)
                .start();
            // localhost rather than whatever the runtime names its host, since the certificate names it
            ldapUrl = `ldap://localhost:${container.getMappedPort(389)}`;
            ldapsUrl = `ldaps://localhost:${container.getMappedPort(636)}`;
            await sambaTool('user', 'create', 'zibri-service', SERVICE_ACCOUNT.password);
            await sambaTool('user', 'create', 'anna', ANNA_PASSWORD);
            await sambaTool('user', 'create', 'bob', BOB_PASSWORD);
            await sambaTool('user', 'create', 'carla', CARLA_PASSWORD);
            await sambaTool('user', 'disable', 'carla');
            await sambaTool('user', 'create', 'dave', DAVE_PASSWORD);
            await sambaTool('user', 'create', 'eve', EVE_PASSWORD);
            await sambaTool('group', 'add', 'staff');
            await sambaTool('group', 'add', 'admins');
            await sambaTool('group', 'addmembers', 'staff', 'dave');
            // a member of admins through staff
            await sambaTool('group', 'addmembers', 'admins', 'staff');
        }
        catch (error) {
            throw output.explain(error);
        }

        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
            entities: [...defaultTestServerEntities, LdapIdentity],
            allowOrphan: true
        });
        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy],
            authenticators: [LdapsDomain, StartTlsDomain],
            controllers: [ActiveDirectoryLoginController],
            providers: defaultTestServerProviders
        });
        baseUrl = await server.start();
    }, 600000);

    afterAll(async () => {
        await server?.shutdown();
        await container?.stop();
    });

    it('signs in by account name and by user principal name as one user, linked by the objectGUID the domain shows', async () => {
        const first: Response = await signIn({ username: 'anna', password: ANNA_PASSWORD });
        expect(first.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { userId }: JwtAuthData<string> = await first.json();

        // the domain's own tool writes the objectGUID the way Active Directory shows it
        const shown: string = await sambaTool('user', 'show', 'anna', '--attributes=objectGUID');
        expect(firstSignIns.map(entry => entry.id)).toStrictEqual([/objectGUID: (\S+)/.exec(shown)?.[1]]);
        expect(firstSignIns[0]?.attributes['userprincipalname']).toStrictEqual(['anna@zibri.test']);

        const again: Response = await signIn({ username: 'anna@zibri.test', password: ANNA_PASSWORD });
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { userId: againUserId }: JwtAuthData<string> = await again.json();
        expect(againUserId).toBe(userId);
    });

    it('signs in over ldap:// upgraded with StartTLS', async () => {
        expect((await signIn({ username: 'bob', password: BOB_PASSWORD }, 'start-tls')).status).toBe(200);
    });

    it('refuses a wrong password, an unknown name and a disabled account alike', async () => {
        const answers: Response[] = await Promise.all([
            signIn({ username: 'anna', password: 'Wrong-Password-1' }),
            signIn({ username: 'nobody', password: ANNA_PASSWORD }),
            signIn({ username: 'carla', password: CARLA_PASSWORD })
        ]);

        expect(answers.map(res => res.status)).toStrictEqual([401, 401, 401]);
    });

    // an account of its own: the two test domains keep their links apart, so an account signed in
    // through the other one already would be a second first sign-in, creating a user of the same email
    it('signs in by the down-level logon name of the domain, and refuses the one of another', async () => {
        const res: Response = await signIn({ username: String.raw`ZIBRI\eve`, password: EVE_PASSWORD });
        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { userId }: JwtAuthData<string> = await res.json();

        const byAccountName: Response = await signIn({ username: 'eve', password: EVE_PASSWORD });
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { userId: byAccountNameUserId }: JwtAuthData<string> = await byAccountName.json();
        expect(byAccountNameUserId).toBe(userId);
        expect((await signIn({ username: String.raw`OTHER\eve`, password: EVE_PASSWORD })).status).toBe(401);
    });

    it('hands the groups of the account to the hooks, nested ones included, and keeps the roles in step with them', async () => {
        const first: Response = await signIn({ username: 'dave', password: DAVE_PASSWORD });
        expect(first.status).toBe(200);

        // the primary group of the account, Domain Users, is not listed
        expect(firstSignIns.at(-1)?.groups.map(dn => dn.toLowerCase()).sort())
            .toStrictEqual([`cn=admins,${USERS}`.toLowerCase(), `cn=staff,${USERS}`.toLowerCase()]);

        const again: Response = await signIn({ username: 'dave', password: DAVE_PASSWORD });
        expect(again.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { roles }: JwtAuthData<string> = await again.json();
        expect(roles).toStrictEqual([Roles.ADMIN]);
    });

    // evaluation/03-auth-and-security H22
    it('finds an account by its objectGUID on a refresh, and refuses it once the domain disabled it', async () => {
        await sambaTool('user', 'create', 'frank', FRANK_PASSWORD);
        const signedIn: JwtAuthData<string> = await authDataOf(await signIn({ username: 'frank', password: FRANK_PASSWORD }));
        const refreshed: JwtAuthData<string> = await authDataOf(await refresh(signedIn.refreshToken.value));

        await sambaTool('user', 'disable', 'frank');

        expect((await refresh(refreshed.refreshToken.value)).status).toBe(403);
    });
});