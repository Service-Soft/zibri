import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, FakeLdapDirectory, FakeLdapEntry, InMemoryDataSource, startFakeLdapDirectory } from 'zibri-testing';

import { BaseActiveDirectoryAuthenticator } from './base-active-directory.authenticator.ts';
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

const DOMAIN: string = 'DC=zibri,DC=test';
const USERS: string = `CN=Users,${DOMAIN}`;
const GROUPS: string = `OU=Groups,${DOMAIN}`;
const SERVICE_ACCOUNT: LdapServiceAccount = { dn: `CN=zibri,${USERS}`, password: 'service-secret' };

/**
 * A group of the domain.
 * @param name - Its name.
 * @param members - The distinguished names of its members.
 * @returns The entry.
 */
function group(name: string, members: string[]): FakeLdapEntry {
    return { dn: `CN=${name},${GROUPS}`, attributes: { objectClass: ['top', 'group'], cn: [name], member: members } };
}

/**
 * An account of the domain.
 * @param name - Its account name.
 * @param objectGuid - The 16 bytes of its `objectGUID`.
 * @returns The entry, with the password `{name}-secret`.
 */
function account(name: string, objectGuid: Buffer): FakeLdapEntry {
    return {
        dn: `CN=${name},${USERS}`,
        password: `${name}-secret`,
        attributes: {
            objectClass: ['top', 'person', 'organizationalPerson', 'user'],
            objectCategory: ['person'],
            sAMAccountName: [name],
            userPrincipalName: [`${name}@zibri.test`],
            objectGUID: [objectGuid]
        }
    };
}

let directory: FakeLdapDirectory;

/**
 * Every entry the hook was handed, in order.
 */
const firstSignIns: LdapEntry[] = [];

class CompanyActiveDirectory extends BaseActiveDirectoryAuthenticator<Roles, JwtUser> {
    readonly name: string = 'company-ad';

    readonly netbiosName: string = 'ZIBRI';

    readonly serviceAccount: LdapServiceAccount = SERVICE_ACCOUNT;

    readonly searchBase: string = USERS;

    readonly groupSearchBase: string = DOMAIN;

    // read as the authenticator is built, which is once the directory is started
    override readonly trustedCertificates: string[] = [directory.certificate];

    get urls(): string[] {
        return [directory.ldapsUrl];
    }

    async resolveFirstSignIn(entry: LdapEntry, transaction: Transaction | undefined): Promise<JwtUser> {
        firstSignIns.push(entry);
        const [email] = entry.attributes['userprincipalname'] ?? [];
        return await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: email ?? '', roles: [Roles.USER] }, { transaction });
    }

    async resolveSignIn(_entry: LdapEntry, user: JwtUser): Promise<JwtUser> {
        return await Promise.resolve(user);
    }
}

@Auth.skip({ allowRedundant: true })
@Controller('/login-ad', { allowOrphan: true })
class ActiveDirectoryLoginController {
    @Post('/')
    async login(
        @Body(LdapCredentials)
        credentials: LdapCredentials
    ): Promise<JwtAuthData<string>> {
        return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).login(CompanyActiveDirectory, JwtAuthStrategy, credentials, undefined);
    }

    @Post('/refresh')
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
 * Posts to the login route.
 * @param credentials - What the user typed.
 * @returns The answer.
 */
async function postLogin(credentials: LdapCredentials): Promise<Response> {
    return await fetch(`${baseUrl}/login-ad`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify(credentials)
    });
}

/**
 * Signs in through the login route, and reads the user it logged in as.
 * @param credentials - What the user typed.
 * @returns The id of the user.
 */
async function signIn(credentials: LdapCredentials): Promise<string> {
    return (await authDataOf(await postLogin(credentials))).userId;
}

/**
 * Posts to the refresh route.
 * @param refreshToken - The refresh token of the login.
 * @returns The answer.
 */
async function refresh(refreshToken: string): Promise<Response> {
    return await fetch(`${baseUrl}/login-ad/refresh`, {
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
 * The filter of the last search for an account, rather than for its groups.
 * @returns The filter.
 */
function lastAccountSearch(): string | undefined {
    return directory.searches.filter(search => search.baseDn === USERS).at(-1)?.filter;
}

beforeAll(async () => {
    directory = await startFakeLdapDirectory({
        entries: [
            { dn: SERVICE_ACCOUNT.dn, password: SERVICE_ACCOUNT.password, attributes: { objectClass: ['user'], sAMAccountName: ['zibri'] } },
            // bytes that are all valid text, which a client reads as a string unless told otherwise
            account('anna', Buffer.from('001122334455667708192a3b4c5d6e7f', 'hex')),
            account('bob', Buffer.from('f0e1d2c3b4a5968778695a4b3c2d1e0f', 'hex')),
            account('carla', Buffer.from('a0a1a2a3a4a5a6a7a8a9aaabacadaeaf', 'hex')),
            group('staff', [`CN=carla,${USERS}`]),
            // a member of admins through staff
            group('admins', [`CN=staff,${GROUPS}`]),
            group('sales', [`CN=bob,${USERS}`])
        ]
    });
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [...defaultTestServerEntities, LdapIdentity],
        allowOrphan: true
    });
    server = await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies: [JwtAuthStrategy],
        authenticators: [CompanyActiveDirectory],
        controllers: [ActiveDirectoryLoginController],
        providers: defaultTestServerProviders
    });
    baseUrl = await server.start();
});

afterAll(async () => {
    await server?.shutdown();
    await directory?.stop();
});

describe('BaseActiveDirectoryAuthenticator', () => {
    it('signs in by account name and by user principal name as one user, linked by the objectGUID as Active Directory writes it', async () => {
        const userId: string = await signIn({ username: 'anna', password: 'anna-secret' });

        expect(await signIn({ username: 'anna@zibri.test', password: 'anna-secret' })).toBe(userId);
        expect(firstSignIns.map(entry => entry.id)).toStrictEqual(['33221100-5544-7766-0819-2a3b4c5d6e7f']);
        expect(lastAccountSearch()).toBe(
            '(&(&(objectcategory=person)(objectclass=user))(|(samaccountname=anna@zibri.test)(userprincipalname=anna@zibri.test)))'
        );
    });

    it('reads an objectGUID whose bytes are not text', async () => {
        await signIn({ username: 'bob', password: 'bob-secret' });

        expect(firstSignIns.at(-1)?.id).toBe('c3d2e1f0-a5b4-8796-7869-5a4b3c2d1e0f');
    });

    it('signs in by the down-level logon name of this domain, and refuses the one of another', async () => {
        const userId: string = await signIn({ username: 'anna', password: 'anna-secret' });

        expect(await signIn({ username: String.raw`ZIBRI\anna`, password: 'anna-secret' })).toBe(userId);
        expect(lastAccountSearch()).toBe('(&(&(objectcategory=person)(objectclass=user))(samaccountname=anna))');
        expect(await signIn({ username: String.raw`zibri\anna`, password: 'anna-secret' })).toBe(userId);

        const searchesBefore: number = directory.searches.length;
        expect((await postLogin({ username: String.raw`OTHER\anna`, password: 'anna-secret' })).status).toBe(401);
        expect((await postLogin({ username: 'ZIBRI\\', password: 'anna-secret' })).status).toBe(401);
        // refused without a search for the name
        expect(directory.searches.slice(searchesBefore)).toStrictEqual([]);
    });

    it('finds the groups of an account, nested ones included, in one search with the in-chain rule', async () => {
        const searchesBefore: number = directory.searches.length;

        await signIn({ username: 'carla', password: 'carla-secret' });

        expect([...firstSignIns.at(-1)?.groups ?? []].sort()).toStrictEqual([`CN=admins,${GROUPS}`, `CN=staff,${GROUPS}`]);
        expect(directory.searches.slice(searchesBefore).map(search => search.filter)).toStrictEqual([
            expect.stringContaining('(samaccountname=carla)'),
            `(&(objectclass=group)(member:1.2.840.113556.1.4.1941:=CN=carla,${USERS}))`
        ]);
    });

    // evaluation/03-auth-and-security H22
    it('finds an account by its objectGUID on a refresh, and refuses it once its userAccountControl marks it disabled', async () => {
        // bytes that are not text, so only the objectGUID as Active Directory holds it finds the account
        const dora: FakeLdapEntry = account('dora', Buffer.from('d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f', 'hex'));
        dora.attributes['userAccountControl'] = ['512'];
        directory.entries.push(dora);
        const signedIn: JwtAuthData<string> = await authDataOf(await postLogin({ username: 'dora', password: 'dora-secret' }));

        const refreshed: JwtAuthData<string> = await authDataOf(await refresh(signedIn.refreshToken.value));
        // a normal account that is disabled
        dora.attributes['userAccountControl'] = ['514'];

        expect((await refresh(refreshed.refreshToken.value)).status).toBe(403);
    });
});