import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client, Entry } from 'ldapts';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { createFakeKeyPair, createInMemoryDataSource, FakeKeyPair, InMemoryDataSource } from 'zibri-testing';

import { BaseLdapAuthenticator } from './base-ldap.authenticator';
import { LdapCredentials } from './ldap-credentials.model';
import { LdapEntry } from './ldap-entry.model';
import { LdapIdentity } from './ldap-identity.model';
import { LdapServiceAccount } from './ldap-service-account.model';
import { ContainerOutput } from '../../../__testing__/container-output.model';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { KnownHeader } from '../../../http/known-header.enum';
import { MimeType } from '../../../http/mime-type.enum';
import { Body } from '../../../routing/decorators/body.decorator';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Param } from '../../../routing/decorators/param.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { Newable } from '../../../types/newable.type';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { Auth } from '../../decorators/auth.decorator';
import { JwtAuthData } from '../../strategies/jwt/jwt-auth-data.model';
import { JwtAuthStrategy } from '../../strategies/jwt/jwt.auth-strategy';

// the 389 Directory Server project's own image
const DIRECTORY_TEST_IMAGE: string = '389ds/dirsrv:3.1';
const LDAP_PORT: number = 3389;
const LDAPS_PORT: number = 3636;
const SUFFIX: string = 'dc=zibri,dc=test';
const PEOPLE: string = `ou=people,${SUFFIX}`;
const GROUPS: string = `ou=groups,${SUFFIX}`;
// the administrator of the directory, which is all a fresh instance has. A deployment gives the
// application an account that may read people and nothing else
const DIRECTORY_MANAGER: LdapServiceAccount = { dn: 'cn=Directory Manager', password: 'directory-manager-secret' };

let container: StartedTestContainer;
// the directory's software wants the authority beside its certificate, and refuses to start when
// they are one and the same
let authority: FakeKeyPair;
let tlsKey: FakeKeyPair;
let ldapUrl: string;
let ldapsUrl: string;

/**
 * Every entry the hook was handed, in order.
 */
const firstSignIns: LdapEntry[] = [];

abstract class TestDirectory extends BaseLdapAuthenticator<Roles, JwtUser> {
    readonly serviceAccount: LdapServiceAccount = DIRECTORY_MANAGER;

    readonly searchBase: string = PEOPLE;

    readonly entryFilter: string = '(objectClass=inetOrgPerson)';

    readonly usernameAttributes: string[] = ['uid', 'mail'];

    readonly groupSearchBase: string = GROUPS;

    // the id 389 Directory Server gives every entry
    override readonly idAttribute: string = 'nsUniqueId';

    // read as the authenticator is built, which is once the key is made
    override readonly trustedCertificates: string[] = [authority.certificate];

    async resolveFirstSignIn(entry: LdapEntry, transaction: Transaction | undefined): Promise<JwtUser> {
        firstSignIns.push(entry);
        const [email] = entry.attributes['mail'] ?? [];
        return await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: email ?? '', roles: [Roles.USER] }, { transaction });
    }

    async resolveSignIn(entry: LdapEntry, user: JwtUser, transaction: Transaction | undefined): Promise<JwtUser> {
        const roles: Roles[] = entry.groups.some(dn => dn.toLowerCase() === `cn=admins,${GROUPS}`) ? [Roles.ADMIN] : [Roles.USER];
        return await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).updateById(user.id, { roles }, { transaction });
    }
}

class LdapsDirectory extends TestDirectory {
    readonly name: string = 'ldaps';

    get urls(): string[] {
        return [ldapsUrl];
    }
}

class StartTlsDirectory extends TestDirectory {
    readonly name: string = 'start-tls';

    get urls(): string[] {
        return [ldapUrl];
    }
}

const DIRECTORIES: Record<string, Newable<TestDirectory>> = { ldaps: LdapsDirectory, 'start-tls': StartTlsDirectory };

@Auth.skip({ allowRedundant: true })
@Controller('/login-ldap', { allowOrphan: true })
class LdapLoginController {
    @Post('/:directory')
    async login(
        @Param.path('directory')
        name: string,
        @Body(LdapCredentials)
        credentials: LdapCredentials
    ): Promise<JwtAuthData<string>> {
        const authenticator: Newable<TestDirectory> | undefined = DIRECTORIES[name];
        if (authenticator == undefined) {
            throw new Error(`No directory is called ${name}.`);
        }
        return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).login(authenticator, JwtAuthStrategy, credentials, undefined);
    }
}

let server: StartedTestServer;
let baseUrl: string;

/**
 * Signs in through the login route of a directory.
 * @param credentials - What the user typed.
 * @param name - The directory.
 * @returns The answer.
 */
async function signIn(credentials: LdapCredentials, name: string = 'ldaps'): Promise<Response> {
    return await fetch(`${baseUrl}/login-ldap/${name}`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify(credentials)
    });
}

/**
 * Asks the directory itself, as its administrator.
 * @param work - What to do with the connection.
 * @returns What the work answered.
 */
async function asAdministrator<T>(work: (client: Client) => Promise<T>): Promise<T> {
    const client: Client = new Client({ url: ldapsUrl, tlsOptions: { ca: [authority.certificate] } });
    try {
        await client.bind(DIRECTORY_MANAGER.dn, DIRECTORY_MANAGER.password);
        return await work(client);
    }
    finally {
        await client.unbind();
    }
}

/**
 * Adds a person to the directory.
 * @param uid - Their account name.
 * @param attributes - Anything else the entry has.
 */
async function addPerson(uid: string, attributes: Record<string, string> = {}): Promise<void> {
    await asAdministrator(client => client.add(`uid=${uid},${PEOPLE}`, {
        objectClass: ['top', 'person', 'organizationalPerson', 'inetOrgPerson'],
        uid,
        cn: uid,
        sn: uid,
        mail: `${uid}@zibri.test`,
        userPassword: `${uid}-secret`,
        ...attributes
    }));
}

/**
 * Adds a group to the directory.
 * @param cn - The name of the group.
 * @param members - The distinguished names of its members.
 */
async function addGroup(cn: string, members: string[]): Promise<void> {
    await asAdministrator(client => client.add(`cn=${cn},${GROUPS}`, { objectClass: ['top', 'groupOfNames'], cn, member: members }));
}

describe('BaseLdapAuthenticator against 389 Directory Server', () => {
    beforeAll(async () => {
        authority = await createFakeKeyPair('CN=Zibri test authority', { authority: true });
        tlsKey = await createFakeKeyPair('CN=localhost', { hosts: ['localhost', '127.0.0.1'], issuer: authority });
        const output: ContainerOutput = new ContainerOutput();
        try {
            container = await new GenericContainer(DIRECTORY_TEST_IMAGE)
                .withEnvironment({ DS_DM_PASSWORD: DIRECTORY_MANAGER.password, DS_SUFFIX_NAME: SUFFIX })
                // a certificate of the test's own, so that the client checks it as it would any other
                .withCopyContentToContainer([
                    { content: tlsKey.certificate, target: '/data/tls/server.crt', mode: 0o644 },
                    { content: tlsKey.privateKey, target: '/data/tls/server.key', mode: 0o644 },
                    { content: authority.certificate, target: '/data/tls/ca/ca.crt', mode: 0o644 }
                ])
                .withExposedPorts(LDAP_PORT, LDAPS_PORT)
                .withLogConsumer(output.consume)
                // not the image's health check: its setup runs a server of its own for a moment, which
                // the check already answers healthy, then stops it. The line comes once the real server
                // runs and the password of the administrator is set
                .withWaitStrategy(Wait.forLogMessage('389-ds-container started.'))
                .withStartupTimeout(150000)
                .start();
            // localhost rather than whatever the runtime names its host, since the certificate names it
            ldapUrl = `ldap://localhost:${container.getMappedPort(LDAP_PORT)}`;
            ldapsUrl = `ldaps://localhost:${container.getMappedPort(LDAPS_PORT)}`;
            const created: { exitCode: number, output: string } = await container.exec(
                ['dsconf', 'localhost', 'backend', 'create', '--suffix', SUFFIX, '--be-name', 'userroot', '--create-suffix', '--create-entries']
            );
            if (created.exitCode !== 0) {
                throw new Error(`Creating the backend failed: ${created.output}`);
            }
            await addPerson('anna');
            await addPerson('bob');
            // an inactivated account, which the directory refuses whatever the password
            await addPerson('carla', { nsAccountLock: 'true' });
            await addPerson('dave');
            await addGroup('staff', [`uid=dave,${PEOPLE}`]);
            // a member of admins through staff
            await addGroup('admins', [`cn=staff,${GROUPS}`]);
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
            authenticators: [LdapsDirectory, StartTlsDirectory],
            controllers: [LdapLoginController],
            providers: defaultTestServerProviders
        });
        baseUrl = await server.start();
    }, 200000);

    afterAll(async () => {
        await server?.shutdown();
        await container?.stop();
    });

    it('signs in over ldaps, linked by the nsUniqueId the directory gave the entry', async () => {
        const first: Response = await signIn({ username: 'anna', password: 'anna-secret' });
        expect(first.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { userId }: JwtAuthData<string> = await first.json();

        const [stored] = await asAdministrator(async client => (await client.search(PEOPLE, {
            filter: '(uid=anna)',
            attributes: ['nsUniqueId']
        })).searchEntries);
        const nsUniqueId: Entry[string] | undefined = stored?.['nsUniqueId'];
        expect(firstSignIns.map(entry => entry.id)).toStrictEqual([nsUniqueId]);
        expect(firstSignIns[0]?.attributes['mail']).toStrictEqual(['anna@zibri.test']);

        const again: Response = await signIn({ username: 'anna@zibri.test', password: 'anna-secret' });
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { userId: againUserId }: JwtAuthData<string> = await again.json();
        expect(againUserId).toBe(userId);
    });

    it('signs in over ldap:// upgraded with StartTLS', async () => {
        expect((await signIn({ username: 'bob', password: 'bob-secret' }, 'start-tls')).status).toBe(200);
    });

    it('refuses a wrong password, an unknown name and an inactivated account alike', async () => {
        const answers: Response[] = await Promise.all([
            signIn({ username: 'anna', password: 'wrong' }),
            signIn({ username: 'nobody', password: 'anna-secret' }),
            signIn({ username: 'carla', password: 'carla-secret' })
        ]);

        expect(answers.map(res => res.status)).toStrictEqual([401, 401, 401]);
    });

    it('reads the typed name as a name, never as a part of the filter', async () => {
        expect((await signIn({ username: 'ann*', password: 'anna-secret' })).status).toBe(401);
    });

    it('hands the groups of the entry to the hooks, nested ones included, and keeps the roles in step with them', async () => {
        const first: Response = await signIn({ username: 'dave', password: 'dave-secret' });
        expect(first.status).toBe(200);

        // a distinguished name is the same name whatever its case
        expect(firstSignIns.at(-1)?.groups.map(dn => dn.toLowerCase()).sort()).toStrictEqual([`cn=admins,${GROUPS}`, `cn=staff,${GROUPS}`]);

        const again: Response = await signIn({ username: 'dave', password: 'dave-secret' });
        expect(again.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const { roles }: JwtAuthData<string> = await again.json();
        expect(roles).toStrictEqual([Roles.ADMIN]);
    });
});