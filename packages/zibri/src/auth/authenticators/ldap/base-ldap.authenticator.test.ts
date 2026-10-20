import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, FakeLdapDirectory, FakeLdapEntry, InMemoryDataSource, startFakeLdapDirectory } from 'zibri-testing';

import { BaseLdapAuthenticator } from './base-ldap.authenticator.ts';
import { DisabledLdapEntriesCronJob } from './disabled-ldap-entries.cron-job.ts';
import { LdapCredentials } from './ldap-credentials.model.ts';
import { LdapEntry } from './ldap-entry.model.ts';
import { LdapIdentity, LdapIdentityCreateData } from './ldap-identity.model.ts';
import { LdapServiceAccount } from './ldap-service-account.model.ts';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers.ts';
import { startAndStopTestServerWithout } from '../../../__testing__/test-server/start-and-stop-test-server-without.function.ts';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function.ts';
import { CronJobEntity } from '../../../cron/cron-job-entity.model.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { Transaction } from '../../../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { ForbiddenError } from '../../../error-handling/errors/forbidden.error.ts';
import { KnownHeader } from '../../../http/known-header.enum.ts';
import { MimeType } from '../../../http/mime-type.enum.ts';
import { $ts } from '../../../localization/translate.function.ts';
import { AuditAction, AuditOutcome, AuditReason } from '../../../logging/audit-event.model.ts';
import { Log } from '../../../logging/log.model.ts';
import { type LoggerInterface } from '../../../logging/logger.interface.ts';
import { Body } from '../../../routing/decorators/body.decorator.ts';
import { Controller } from '../../../routing/decorators/controller.decorator.ts';
import { Param } from '../../../routing/decorators/param.decorator.ts';
import { Post } from '../../../routing/decorators/post.decorator.ts';
import { Newable } from '../../../types/newable.type.ts';
import { JsonUtilities } from '../../../utilities/json.utilities.ts';
import { AuthControllerUtilities } from '../../auth-controller/auth-controller.utilities.ts';
import { Auth } from '../../decorators/auth.decorator.ts';
import { ApiKeyAuthStrategy } from '../../strategies/api-key/api-key.auth-strategy.ts';
import { ApiKey } from '../../strategies/api-key/api-key.model.ts';
import { CreatedApiKey } from '../../strategies/api-key/created-api-key.model.ts';
import { JwtAuthData } from '../../strategies/jwt/jwt-auth-data.model.ts';
import { JwtRefreshLoginDto } from '../../strategies/jwt/jwt-refresh-login-data.model.ts';
import { JwtAuthStrategy } from '../../strategies/jwt/jwt.auth-strategy.ts';

const SEARCH_BASE: string = 'ou=people,dc=zibri,dc=test';
const GROUP_SEARCH_BASE: string = 'ou=groups,dc=zibri,dc=test';
const SERVICE_ACCOUNT: LdapServiceAccount = { dn: 'cn=zibri,ou=services,dc=zibri,dc=test', password: 'service-secret' };
const ANNA_ID: string = '4b0e7c64-5b9a-4a8e-9a83-1f6f2b9d0a11';
// the same on both servers of the replicated directory, which links it by its id
const KATE_ID: string = '0d8f3a52-7c41-4e9b-b6a2-93e5f1c7d204';

/**
 * A person of the directory.
 * @param uid - Their account name.
 * @param attributes - Anything else the entry has.
 * @returns The entry, with the password `{uid}-secret`.
 */
function person(uid: string, attributes: Record<string, string[]> = {}): FakeLdapEntry {
    return {
        dn: `uid=${uid},${SEARCH_BASE}`,
        password: `${uid}-secret`,
        attributes: { objectClass: ['inetOrgPerson'], uid: [uid], mail: [`${uid}@zibri.test`], cn: [uid], ...attributes }
    };
}

/**
 * The distinguished name of a group below the group search base.
 * @param cn - The name of the group.
 * @returns The distinguished name.
 */
function groupDn(cn: string): string {
    return `cn=${cn},${GROUP_SEARCH_BASE}`;
}

/**
 * A group of the directory.
 * @param cn - The name of the group.
 * @param members - The distinguished names of its members.
 * @returns The entry.
 */
function group(cn: string, members: string[]): FakeLdapEntry {
    return { dn: groupDn(cn), attributes: { objectClass: ['groupOfNames'], cn: [cn], member: members } };
}

let directory: FakeLdapDirectory;
// a second server of the same directory, for the authenticator that knows both
let replica: FakeLdapDirectory;
// a server that was started and stopped again, so nothing answers on its ports
let unreachable: FakeLdapDirectory;

/**
 * Every entry the first sign-in hook was handed, in order.
 */
const firstSignIns: LdapEntry[] = [];

/**
 * Every entry the hook of a later sign-in was handed, in order.
 */
const laterSignIns: LdapEntry[] = [];

/**
 * The directory the tests sign in at, with a hook that creates a user from the entry's email, and one
 * that gives the user the admin role while the entry is in the admins group.
 */
abstract class TestDirectory extends BaseLdapAuthenticator<Roles, JwtUser> {
    readonly serviceAccount: LdapServiceAccount = SERVICE_ACCOUNT;

    readonly searchBase: string = SEARCH_BASE;

    readonly entryFilter: string = '(objectClass=inetOrgPerson)';

    readonly usernameAttributes: string[] = ['uid', 'mail'];

    readonly groupSearchBase: string | undefined = undefined;

    // read as the authenticator is built, which is once the directory is started
    override readonly trustedCertificates: string[] = [directory.certificate];

    async resolveFirstSignIn(entry: LdapEntry, transaction: Transaction | undefined): Promise<JwtUser> {
        firstSignIns.push(entry);
        // long enough for a second sign-in as the same entry to arrive meanwhile
        await new Promise(resolve => setTimeout(resolve, 50));
        const [email] = entry.attributes['mail'] ?? [];
        if (email == undefined) {
            throw new ForbiddenError($ts`The directory has no email for this account.`);
        }
        return await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] }, { transaction });
    }

    async resolveSignIn(entry: LdapEntry, user: JwtUser, transaction: Transaction | undefined): Promise<JwtUser> {
        laterSignIns.push(entry);
        const roles: Roles[] = entry.groups.some(dn => dn.toLowerCase() === groupDn('admins')) ? [Roles.ADMIN] : [Roles.USER];
        return await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).updateById(user.id, { roles }, { transaction });
    }
}

class CompanyDirectory extends TestDirectory {
    readonly name: string = 'company';

    get urls(): string[] {
        return [directory.ldapsUrl];
    }
}

class StartTlsDirectory extends TestDirectory {
    readonly name: string = 'start-tls';

    get urls(): string[] {
        return [directory.ldapUrl];
    }
}

// trusts only the certificates of the system, which do not include the directory's own
class UntrustingDirectory extends TestDirectory {
    readonly name: string = 'untrusting';

    get urls(): string[] {
        return [directory.ldapsUrl];
    }

    override readonly trustedCertificates: string[] = [];
}

class WrongServiceAccountDirectory extends TestDirectory {
    readonly name: string = 'wrong-service-account';

    override readonly serviceAccount: LdapServiceAccount = { dn: SERVICE_ACCOUNT.dn, password: 'not-the-password' };

    get urls(): string[] {
        return [directory.ldapsUrl];
    }
}

class GroupsDirectory extends TestDirectory {
    readonly name: string = 'groups';

    override readonly groupSearchBase: string = GROUP_SEARCH_BASE;

    get urls(): string[] {
        return [directory.ldapsUrl];
    }
}

class ReplicatedDirectory extends TestDirectory {
    readonly name: string = 'replicated';

    override readonly trustedCertificates: string[] = [directory.certificate, replica.certificate];

    get urls(): string[] {
        return [directory.ldapsUrl, replica.ldapsUrl];
    }
}

class PartlyUnreachableDirectory extends TestDirectory {
    readonly name: string = 'partly-unreachable';

    get urls(): string[] {
        return [unreachable.ldapsUrl, directory.ldapsUrl];
    }
}

class UnreachableDirectory extends TestDirectory {
    readonly name: string = 'unreachable';

    get urls(): string[] {
        return [unreachable.ldapsUrl];
    }
}

/**
 * Whether the server of the switchable directory can be reached.
 */
let switchableReachable: boolean = true;

class SwitchableDirectory extends TestDirectory {
    readonly name: string = 'switchable';

    get urls(): string[] {
        return [switchableReachable ? directory.ldapsUrl : unreachable.ldapsUrl];
    }
}

const DIRECTORIES: Record<string, Newable<TestDirectory>> = {
    company: CompanyDirectory,
    'start-tls': StartTlsDirectory,
    untrusting: UntrustingDirectory,
    'wrong-service-account': WrongServiceAccountDirectory,
    groups: GroupsDirectory,
    replicated: ReplicatedDirectory,
    'partly-unreachable': PartlyUnreachableDirectory,
    unreachable: UnreachableDirectory,
    switchable: SwitchableDirectory
};

/**
 * How long a login in a transaction waits before it commits, longer than a waiting sign-in takes to
 * ask for the lease again.
 */
const SLOW_COMMIT_IN_MS: number = 300;

function getDirectory(name: string): Newable<TestDirectory> {
    const authenticator: Newable<TestDirectory> | undefined = DIRECTORIES[name];
    if (authenticator == undefined) {
        throw new Error(`No directory is called ${name}.`);
    }
    return authenticator;
}

@Auth.skip({ allowRedundant: true })
@Controller('/login-ldap', { allowOrphan: true })
class LdapLoginController {
    // what an application writes: a login route of its own for the directory
    @Post('/:directory')
    async login(
        @Param.path('directory')
        name: string,
        @Body(LdapCredentials)
        credentials: LdapCredentials
    ): Promise<JwtAuthData<string>> {
        return await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).login(getDirectory(name), JwtAuthStrategy, credentials, undefined);
    }

    // what the login routes of AuthController do: the login in a transaction, committed once the
    // session is started - here a while after, as a slow commit would
    @Post('/:directory/in-transaction')
    async loginInTransaction(
        @Param.path('directory')
        name: string,
        @Body(LdapCredentials)
        credentials: LdapCredentials
    ): Promise<JwtAuthData<string>> {
        return await AuthControllerUtilities.runInTransaction(JwtAuthStrategy, async transaction => {
            const authData: JwtAuthData<string> = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
                .login(getDirectory(name), JwtAuthStrategy, credentials, transaction);
            await sleep(SLOW_COMMIT_IN_MS);
            return authData;
        });
    }

    // what the refresh route of AuthController does. Two parts, so that it is not taken for a directory
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
 * Signs in through the login route of a directory.
 * @param credentials - What the user typed.
 * @param name - The directory.
 * @returns The answer.
 */
async function signIn(credentials: LdapCredentials, name: string = 'company'): Promise<Response> {
    return await fetch(`${baseUrl}/login-ldap/${name}`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify(credentials)
    });
}

/**
 * Signs in through the login route of a directory that logs in inside a transaction, and commits it
 * late.
 * @param credentials - What the user typed.
 * @param name - The directory.
 * @returns The answer.
 */
async function signInInTransaction(credentials: LdapCredentials, name: string = 'company'): Promise<Response> {
    return await fetch(`${baseUrl}/login-ldap/${name}/in-transaction`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify(credentials)
    });
}

/**
 * Refreshes a login through the refresh route.
 * @param refreshToken - The refresh token of the login.
 * @returns The answer.
 */
async function refresh(refreshToken: string): Promise<Response> {
    return await fetch(`${baseUrl}/login-ldap/tokens/refresh`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify({ refreshToken })
    });
}

/**
 * Adds a person to the directory while the tests run.
 * @param uid - Their account name.
 * @returns The entry, which the test may change.
 */
function addPerson(uid: string): FakeLdapEntry {
    const entry: FakeLdapEntry = person(uid, { entryUUID: [randomUUID()] });
    directory.entries.push(entry);
    return entry;
}

/**
 * Runs the job that looks for disabled entries once, built by hand since the test server runs no cron
 * jobs.
 */
async function runDisabledEntriesJob(): Promise<void> {
    const job: DisabledLdapEntriesCronJob = new DisabledLdapEntriesCronJob();
    await job.init(inject(ZIBRI_DI_TOKENS.LOGGER), inject(repositoryTokenFor(CronJobEntity)), async () => await Promise.resolve(true));
    await job.onTick();
}

/**
 * The link of a user to an entry of the company directory.
 * @param userId - The user.
 * @returns The link.
 */
async function findCompanyLink(userId: string): Promise<LdapIdentity> {
    return await identities().findOne({ where: { directory: 'company', userId } });
}

/**
 * The user a successful sign-in logged in as.
 * @param res - The answer of the sign-in.
 * @returns The id of the user.
 */
async function userIdOf(res: Response): Promise<string> {
    return (await authDataOf(res)).userId;
}

/**
 * What a successful sign-in answered.
 * @param res - The answer of the sign-in.
 * @returns The auth data.
 */
async function authDataOf(res: Response): Promise<JwtAuthData<string>> {
    expect(res.status).toBe(200);
    // eslint-disable-next-line typescript/no-unsafe-assignment
    const authData: JwtAuthData<string> = await res.json();
    return authData;
}

/**
 * The binds a directory was asked for since a point.
 * @param server - The directory.
 * @param since - How many binds it had been asked for before.
 * @param dn - Whose binds to count.
 * @returns How many there were.
 */
function countBinds(server: FakeLdapDirectory, since: number, dn: string): number {
    return server.binds.slice(since).filter(bind => bind.dn === dn).length;
}

/**
 * What the audit trail recorded.
 * @returns Whatever each entry carries under `context.metadata.audit`.
 */
async function auditEvents(): Promise<unknown[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return (await inject(repositoryTokenFor(Log)).findAll({})).map(l => l.context.metadata?.['audit']);
}

/**
 * The links of entries to users.
 * @returns The repository.
 */
function identities(): Repository<LdapIdentity, LdapIdentityCreateData> {
    return inject(repositoryTokenFor(LdapIdentity));
}

/**
 * Starts an application signing in at the given directories.
 * @param authenticators - The directories.
 * @returns The server, started.
 */
async function startApp(authenticators: Newable<BaseLdapAuthenticator<Roles, JwtUser>>[]): Promise<StartedTestServer> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [...defaultTestServerEntities, LdapIdentity, ApiKey],
        allowOrphan: true
    });
    return await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        authenticators,
        controllers: [LdapLoginController],
        providers: defaultTestServerProviders
    });
}

beforeAll(async () => {
    const ivy: string = person('ivy').dn;
    const entries: FakeLdapEntry[] = [
        { dn: SERVICE_ACCOUNT.dn, password: SERVICE_ACCOUNT.password, attributes: { objectClass: ['person'], cn: ['zibri'] } },
        person('anna', { entryUUID: [ANNA_ID] }),
        person('bob'),
        person('carla'),
        person('dave'),
        person('frank'),
        { ...person('erin'), lockedWith: 'invalidCredentials' },
        { ...person('gina'), lockedWith: 'unwillingToPerform' },
        { ...person('hank'), lockedWith: 'constraintViolation' },
        person('nomail', { mail: [] }),
        person('gone'),
        { ...person('twin'), dn: `uid=twin,ou=sales,${SEARCH_BASE}` },
        { ...person('twin'), dn: `uid=twin,ou=support,${SEARCH_BASE}` },
        { ...person('outsider'), dn: 'uid=outsider,ou=elsewhere,dc=zibri,dc=test' },
        person('ivy'),
        person('jack'),
        person('kate', { entryUUID: [KATE_ID] }),
        person('mike'),
        person('olga'),
        group('staff', [ivy]),
        // a member of admins through staff
        group('admins', [groupDn('staff')]),
        // two groups that are members of each other
        group('ring-a', [groupDn('ring-b')]),
        group('ring-b', [groupDn('ring-a'), ivy]),
        { ...group('not-a-group', [ivy]), attributes: { objectClass: ['organizationalRole'], cn: ['not-a-group'], member: [ivy] } },
        { ...group('outside', [ivy]), dn: 'cn=outside,ou=elsewhere,dc=zibri,dc=test' }
    ];
    [directory, replica, unreachable] = await Promise.all([
        startFakeLdapDirectory({ entries }),
        startFakeLdapDirectory({ entries }),
        startFakeLdapDirectory({ entries: [] })
    ]);
    await unreachable.stop();
});

afterEach(() => {
    firstSignIns.length = 0;
    laterSignIns.length = 0;
});

afterAll(async () => {
    await Promise.all([directory?.stop(), replica?.stop()]);
});

// first, for the reason on startAndStopTestServerWithout
describe('BaseLdapAuthenticator — starting', () => {
    it('refuses to start without LdapIdentity, and names it', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([], { authenticators: [CompanyDirectory] });

        await expect(start).rejects.toThrow(/Error initializing CompanyDirectory[\S\s]*LdapIdentity/);
    }, 30000);

    it('refuses to start with a url that is not ldaps:// or ldap://', async () => {
        class PlainDirectory extends TestDirectory {
            readonly name: string = 'plain';

            readonly urls: string[] = ['ldaps://127.0.0.1:636', 'http://127.0.0.1:389'];
        }

        await expect(startApp([PlainDirectory])).rejects.toThrow('have to start with ldaps:// or ldap://');
    }, 30000);

    it('refuses to start without a server', async () => {
        class NoServerDirectory extends TestDirectory {
            readonly name: string = 'no-server';

            readonly urls: string[] = [];
        }

        await expect(startApp([NoServerDirectory])).rejects.toThrow('names no server of the directory');
    }, 30000);

    it('refuses to start with a groupFilter that is not an LDAP filter', async () => {
        class BrokenGroupFilterDirectory extends GroupsDirectory {
            override readonly groupFilter: string = 'objectClass=group)';
        }

        await expect(startApp([BrokenGroupFilterDirectory])).rejects.toThrow('The groupFilter of BrokenGroupFilterDirectory is not an LDAP filter.');
    }, 30000);

    it('refuses to start with two directories of the same name', async () => {
        class SameNameDirectory extends TestDirectory {
            readonly name: string = 'company';

            get urls(): string[] {
                return [directory.ldapUrl];
            }
        }

        await expect(startApp([CompanyDirectory, SameNameDirectory])).rejects.toThrow('share the name "company"');
    }, 30000);
});

describe('BaseLdapAuthenticator', () => {
    beforeAll(async () => {
        server = await startApp(Object.values(DIRECTORIES));
        baseUrl = await server.start();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('signs a linked entry in as its user, found by the service account and checked by a bind', async () => {
        const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: 'anna.linked@zibri.test', roles: [Roles.USER] });
        await identities().create({ directory: 'company', entryId: ANNA_ID, userId: user.id });
        const bindsBefore: number = directory.binds.length;

        expect(await userIdOf(await signIn({ username: 'anna', password: 'anna-secret' }))).toBe(user.id);

        expect(directory.binds.slice(bindsBefore)).toStrictEqual([
            { dn: SERVICE_ACCOUNT.dn, withPassword: true, encrypted: true, succeeded: true },
            { dn: `uid=anna,${SEARCH_BASE}`, withPassword: true, encrypted: true, succeeded: true }
        ]);
        expect(directory.searches.at(-1)).toStrictEqual({
            baseDn: SEARCH_BASE,
            filter: '(&(objectclass=inetorgperson)(|(uid=anna)(mail=anna)))',
            boundAs: SERVICE_ACCOUNT.dn
        });
        expect(firstSignIns).toStrictEqual([]);
    });

    it('signs in by any of the attributes a name is looked for in', async () => {
        const byUid: string = await userIdOf(await signIn({ username: 'bob', password: 'bob-secret' }));

        expect(await userIdOf(await signIn({ username: 'bob@zibri.test', password: 'bob-secret' }))).toBe(byUid);
    });

    it('hands the first sign-in as an entry to resolveFirstSignIn, and finds the user it answered from then on', async () => {
        const userId: string = await userIdOf(await signIn({ username: 'carla', password: 'carla-secret' }));

        expect(firstSignIns).toHaveLength(1);
        const [entry] = firstSignIns;
        expect(entry?.dn).toBe(`uid=carla,${SEARCH_BASE}`);
        expect(entry?.attributes['mail']).toStrictEqual(['carla@zibri.test']);
        expect(entry?.attributes['objectclass']).toStrictEqual(['inetOrgPerson']);
        expect(await identities().findAll({ where: { userId } })).toStrictEqual([expect.objectContaining({ directory: 'company', entryId: entry?.id })]);
        const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).findById(userId);
        expect(user.email).toBe('carla@zibri.test');

        expect(await userIdOf(await signIn({ username: 'carla', password: 'carla-secret' }))).toBe(userId);
        expect(firstSignIns).toHaveLength(1);
    });

    it('links two first sign-ins as the same entry at once to one user', async () => {
        const [first, second] = await Promise.all([
            signIn({ username: 'dave', password: 'dave-secret' }),
            signIn({ username: 'dave', password: 'dave-secret' })
        ]);

        const userId: string = await userIdOf(first);
        expect(await userIdOf(second)).toBe(userId);
        expect(firstSignIns).toHaveLength(1);
        expect(await identities().findAll({ where: { userId } })).toHaveLength(1);
    });

    it('links two first sign-ins as the same entry at once to one user while their logins commit late', async () => {
        const [first, second] = await Promise.all([
            signInInTransaction({ username: 'olga', password: 'olga-secret' }),
            signInInTransaction({ username: 'olga', password: 'olga-secret' })
        ]);

        const userId: string = await userIdOf(first);
        expect(await userIdOf(second)).toBe(userId);
        expect(firstSignIns).toHaveLength(1);
        expect(await identities().findAll({ where: { userId } })).toHaveLength(1);
        // the lease lasts until the login commits, so nothing was written outside of it
        await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
        const logs: Log[] = await inject(repositoryTokenFor(Log)).findAll({});
        expect(logs.filter(l => l.message.includes('ldap-first-sign-in'))).toStrictEqual([]);
    });

    it('upgrades a connection to ldap:// with StartTLS before anything is sent', async () => {
        const bindsBefore: number = directory.binds.length;

        expect((await signIn({ username: 'frank', password: 'frank-secret' }, 'start-tls')).status).toBe(200);

        const binds: FakeLdapDirectory['binds'] = directory.binds.slice(bindsBefore);
        expect(binds).toHaveLength(2);
        expect(binds.every(bind => bind.encrypted && bind.succeeded)).toBe(true);
    });

    it('refuses a wrong password, an unknown name and a disabled account alike', async () => {
        const answers: Response[] = await Promise.all([
            signIn({ username: 'anna', password: 'wrong' }),
            signIn({ username: 'nobody', password: 'anna-secret' }),
            signIn({ username: 'erin', password: 'erin-secret' })
        ]);

        expect(answers.map(res => res.status)).toStrictEqual([401, 401, 401]);
        const messages: unknown[] = await Promise.all(answers.map(async res => {
            const body: unknown = await res.json();
            return typeof body === 'object' && body != undefined && 'message' in body ? body.message : undefined;
        }));
        expect(messages[0]).toBeDefined();
        expect(new Set(messages).size).toBe(1);
    });

    it('refuses a locked account whichever way the directory refuses its bind', async () => {
        const answers: Response[] = await Promise.all([
            signIn({ username: 'erin', password: 'erin-secret' }),
            signIn({ username: 'gina', password: 'gina-secret' }),
            signIn({ username: 'hank', password: 'hank-secret' })
        ]);

        expect(answers.map(res => res.status)).toStrictEqual([401, 401, 401]);
    });

    it('binds for an unknown name as well, so that it takes as long as a wrong password', async () => {
        const bindsBefore: number = directory.binds.length;

        expect((await signIn({ username: 'nobody', password: 'some-password' })).status).toBe(401);

        expect(directory.binds.slice(bindsBefore)).toStrictEqual([
            expect.objectContaining({ dn: SERVICE_ACCOUNT.dn, succeeded: true }),
            expect.objectContaining({ withPassword: true, succeeded: false })
        ]);
    });

    it('refuses an empty password before the directory sees it, which would answer with success', async () => {
        const bindsBefore: number = directory.binds.length;

        await expect(inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).login(CompanyDirectory, JwtAuthStrategy, { username: 'anna', password: '' }, undefined))
            .rejects.toThrow('Invalid username or password.');

        expect(directory.binds.slice(bindsBefore)).toStrictEqual([]);
    });

    it('reads the typed name as a name, never as a part of the filter', async () => {
        const res: Response = await signIn({ username: 'ann*', password: 'anna-secret' });

        expect(res.status).toBe(401);
        expect(directory.searches.at(-1)?.filter).toBe(String.raw`(&(objectclass=inetorgperson)(|(uid=ann\2a)(mail=ann\2a)))`);
    });

    it('refuses a name more than one entry has', async () => {
        expect((await signIn({ username: 'twin', password: 'twin-secret' })).status).toBe(401);
    });

    it('finds nobody outside the search base', async () => {
        expect((await signIn({ username: 'outsider', password: 'outsider-secret' })).status).toBe(401);
    });

    it('refuses a sign-in resolveFirstSignIn refuses, and links nothing', async () => {
        const res: Response = await signIn({ username: 'nomail', password: 'nomail-secret' });

        expect(res.status).toBe(403);
        expect(await identities().findAll({ where: { entryId: firstSignIns[0]?.id ?? '' } })).toStrictEqual([]);
    });

    it('refuses an entry whose linked user was deleted', async () => {
        const userId: string = await userIdOf(await signIn({ username: 'gone', password: 'gone-secret' }));
        await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).deleteById(userId);

        const res: Response = await signIn({ username: 'gone', password: 'gone-secret' });

        expect(res.status).toBe(401);
        expect(firstSignIns).toHaveLength(1);
    });

    it('answers a directory it cannot trust or bind to with a 500, recorded as an error rather than a refusal', async () => {
        expect((await signIn({ username: 'anna', password: 'anna-secret' }, 'untrusting')).status).toBe(500);
        expect((await signIn({ username: 'anna', password: 'anna-secret' }, 'wrong-service-account')).status).toBe(500);

        expect(await auditEvents()).toContainEqual(expect.objectContaining({
            action: AuditAction.LOGIN,
            outcome: AuditOutcome.FAILURE,
            reason: AuditReason.ERROR,
            subject: 'anna'
        }));
    });

    it('records the typed name of a refused sign-in in the audit trail', async () => {
        expect((await signIn({ username: 'bob', password: 'wrong' })).status).toBe(401);

        expect(await auditEvents()).toContainEqual(expect.objectContaining({
            action: AuditAction.LOGIN,
            outcome: AuditOutcome.FAILURE,
            reason: AuditReason.REFUSED,
            subject: 'bob'
        }));
    });

    it('hands every later sign-in to resolveSignIn with the linked user, and logs in as the user it answers', async () => {
        const userId: string = await userIdOf(await signIn({ username: 'carla', password: 'carla-secret' }));
        await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).updateById(userId, { roles: [Roles.ADMIN] });
        const laterBefore: number = laterSignIns.length;

        const again: JwtAuthData<string> = await authDataOf(await signIn({ username: 'carla', password: 'carla-secret' }));

        expect(laterSignIns.slice(laterBefore).map(entry => entry.dn)).toStrictEqual([`uid=carla,${SEARCH_BASE}`]);
        // the hook took the role away again, since the entry is in no admins group
        expect(again.userId).toBe(userId);
        expect(again.roles).toStrictEqual([Roles.USER]);
    });

    it('hands the groups of the entry to the hooks, nested ones included, and keeps the roles in step with them', async () => {
        const first: JwtAuthData<string> = await authDataOf(await signIn({ username: 'ivy', password: 'ivy-secret' }, 'groups'));

        const expected: string[] = [groupDn('staff'), groupDn('admins'), groupDn('ring-a'), groupDn('ring-b')].sort();
        expect([...firstSignIns[0]?.groups ?? []].sort()).toStrictEqual(expected);
        expect(first.roles).toStrictEqual([Roles.USER]);

        const second: JwtAuthData<string> = await authDataOf(await signIn({ username: 'ivy', password: 'ivy-secret' }, 'groups'));
        expect([...laterSignIns[0]?.groups ?? []].sort()).toStrictEqual(expected);
        expect(second.roles).toStrictEqual([Roles.ADMIN]);

        // the entry is taken out of staff in the directory, the group that made it an admin
        const staff: FakeLdapEntry | undefined = directory.entries.find(entry => entry.dn === groupDn('staff'));
        const members: (string | Buffer)[] = staff?.attributes['member'] ?? [];
        staff?.attributes['member']?.splice(0);
        try {
            const third: JwtAuthData<string> = await authDataOf(await signIn({ username: 'ivy', password: 'ivy-secret' }, 'groups'));
            expect([...laterSignIns[1]?.groups ?? []].sort()).toStrictEqual([groupDn('ring-a'), groupDn('ring-b')]);
            expect(third.roles).toStrictEqual([Roles.USER]);
        }
        finally {
            staff?.attributes['member']?.push(...members);
        }
    });

    it('reads the groups as the service account, once the password was checked', async () => {
        const bindsBefore: number = directory.binds.length;
        const searchesBefore: number = directory.searches.length;

        expect((await signIn({ username: 'ivy', password: 'wrong' }, 'groups')).status).toBe(401);
        expect(directory.searches.slice(searchesBefore)).toHaveLength(1);

        expect((await signIn({ username: 'ivy', password: 'ivy-secret' }, 'groups')).status).toBe(200);
        expect(directory.binds.slice(bindsBefore).map(bind => bind.dn)).toStrictEqual([
            SERVICE_ACCOUNT.dn,
            person('ivy').dn,
            SERVICE_ACCOUNT.dn,
            person('ivy').dn,
            SERVICE_ACCOUNT.dn
        ]);
        const groupSearches: FakeLdapDirectory['searches'] = directory.searches.slice(searchesBefore + 2);
        expect(groupSearches.length).toBeGreaterThan(0);
        expect(groupSearches.every(search => search.baseDn === GROUP_SEARCH_BASE && search.boundAs === SERVICE_ACCOUNT.dn)).toBe(true);
    });

    it('reads no groups when groupSearchBase is undefined', async () => {
        const searchesBefore: number = directory.searches.length;

        expect((await signIn({ username: 'mike', password: 'mike-secret' })).status).toBe(200);

        expect(directory.searches.slice(searchesBefore)).toHaveLength(1);
        expect(firstSignIns[0]?.groups).toStrictEqual([]);
    });

    it('moves on to the next server when one cannot be reached', async () => {
        // the first server is a random one, so some of these start at the one that is down
        const answers: Response[] = [];
        for (let i: number = 0; i < 8; i++) {
            answers.push(await signIn({ username: 'jack', password: 'jack-secret' }, 'partly-unreachable'));
        }

        expect(answers.map(res => res.status)).toStrictEqual(Array.from({ length: 8 }, () => 200));
    });

    it('starts at a random server, so sign-ins are spread across all of them', async () => {
        const [directoryBefore, replicaBefore] = [directory.binds.length, replica.binds.length];

        // that all 16 start at the same one of two servers is a chance of 1 in 32768
        for (let i: number = 0; i < 16; i++) {
            expect((await signIn({ username: 'kate', password: 'kate-secret' }, 'replicated')).status).toBe(200);
        }

        expect(countBinds(directory, directoryBefore, SERVICE_ACCOUNT.dn)).toBeGreaterThan(0);
        expect(countBinds(replica, replicaBefore, SERVICE_ACCOUNT.dn)).toBeGreaterThan(0);
    });

    it('asks no other server once one refused the password', async () => {
        const [directoryBefore, replicaBefore] = [directory.binds.length, replica.binds.length];

        expect((await signIn({ username: 'kate', password: 'wrong' }, 'replicated')).status).toBe(401);

        const kate: string = person('kate').dn;
        expect(countBinds(directory, directoryBefore, kate) + countBinds(replica, replicaBefore, kate)).toBe(1);
    });

    it('answers a directory none of whose servers can be reached with a 500, recorded as an error', async () => {
        expect((await signIn({ username: 'jack', password: 'jack-secret' }, 'unreachable')).status).toBe(500);

        expect(await auditEvents()).toContainEqual(expect.objectContaining({
            action: AuditAction.LOGIN,
            outcome: AuditOutcome.FAILURE,
            reason: AuditReason.ERROR,
            subject: 'jack'
        }));
    });

    // evaluation/03-auth-and-security H22: a login started before its entry was disabled in the
    // directory lived as long as its refresh credential, with the roles it had
    describe('an entry that changes after its user signed in', () => {
        it('refuses the refresh of a user whose entry was disabled, ends their logins and api keys, and keeps the user active', async () => {
            const entry: FakeLdapEntry = addPerson('paul');
            const first: JwtAuthData<string> = await authDataOf(await signIn({ username: 'paul', password: 'paul-secret' }));
            const second: JwtAuthData<string> = await authDataOf(await signIn({ username: 'paul', password: 'paul-secret' }));
            const { key }: CreatedApiKey = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).createApiKey(
                first.userId,
                { name: 'ci', roles: [Roles.USER], expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
                undefined
            );
            expect(key).toBeDefined();
            // 389 Directory Server's mark of an inactivated account
            entry.attributes['nsAccountLock'] = ['TRUE'];

            const refused: Response = await refresh(first.refreshToken.value);

            expect(refused.status).toBe(403);
            expect(await refused.json()).toMatchObject({ name: 'AccountDeactivatedError' });
            expect((await refresh(second.refreshToken.value)).status).toBe(401);
            expect(await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).findApiKeys(first.userId, undefined)).toEqual([]);
            expect(await auditEvents()).toEqual(expect.arrayContaining([
                { action: AuditAction.REFRESH_LOGIN, outcome: AuditOutcome.FAILURE, reason: AuditReason.DEACTIVATED },
                { action: AuditAction.ACCESS_ENDED, outcome: AuditOutcome.SUCCESS, userId: first.userId }
            ]));

            // enabled again in the directory, they simply sign in
            entry.attributes['nsAccountLock'] = ['FALSE'];
            expect(await userIdOf(await signIn({ username: 'paul', password: 'paul-secret' }))).toBe(first.userId);
        });

        it('refuses the refresh of a user whose entry was deleted', async () => {
            const entry: FakeLdapEntry = addPerson('rosa');
            const tokens: JwtAuthData<string> = await authDataOf(await signIn({ username: 'rosa', password: 'rosa-secret' }));
            directory.entries.splice(directory.entries.indexOf(entry), 1);

            expect((await refresh(tokens.refreshToken.value)).status).toBe(403);
        });

        it('counts an entry an administrator locked as disabled, and one locked by wrong passwords as not', async () => {
            const entry: FakeLdapEntry = addPerson('sara');
            const tokens: JwtAuthData<string> = await authDataOf(await signIn({ username: 'sara', password: 'sara-secret' }));

            // OpenLDAP's password policy, after too many wrong passwords: whoever typed them must not be
            // able to end the logins of the person they were guessing for
            entry.attributes['pwdAccountLockedTime'] = ['20261018120000Z'];
            const refreshed: JwtAuthData<string> = await authDataOf(await refresh(tokens.refreshToken.value));

            // and locked by an administrator, until unlocked
            entry.attributes['pwdAccountLockedTime'] = ['000001010000Z'];
            expect((await refresh(refreshed.refreshToken.value)).status).toBe(403);
        });

        it('brings the roles in step with the groups of the entry on a refresh', async () => {
            const rita: FakeLdapEntry = addPerson('rita');
            const tokens: JwtAuthData<string> = await authDataOf(await signIn({ username: 'rita', password: 'rita-secret' }, 'groups'));
            expect(tokens.roles).toStrictEqual([Roles.USER]);

            const admins: FakeLdapEntry | undefined = directory.entries.find(entry => entry.dn === groupDn('admins'));
            admins?.attributes['member']?.push(rita.dn);
            try {
                const refreshed: JwtAuthData<string> = await authDataOf(await refresh(tokens.refreshToken.value));
                expect(refreshed.roles).toStrictEqual([Roles.ADMIN]);
            }
            finally {
                admins?.attributes['member']?.pop();
            }
        });

        it('answers a refresh with a 500 while the directory cannot be reached, and ends nothing', async () => {
            addPerson('sven');
            const tokens: JwtAuthData<string> = await authDataOf(await signIn({ username: 'sven', password: 'sven-secret' }, 'switchable'));

            switchableReachable = false;
            try {
                expect((await refresh(tokens.refreshToken.value)).status).toBe(500);
            }
            finally {
                switchableReachable = true;
            }

            expect((await refresh(tokens.refreshToken.value)).status).toBe(200);
        });

        it('ends the logins of a user whose entry was disabled from a job, once, and a later sign-in clears the mark', async () => {
            const entry: FakeLdapEntry = addPerson('tina');
            const tokens: JwtAuthData<string> = await authDataOf(await signIn({ username: 'tina', password: 'tina-secret' }));
            entry.attributes['nsAccountLock'] = ['TRUE'];

            await runDisabledEntriesJob();

            expect((await refresh(tokens.refreshToken.value)).status).toBe(401);
            expect((await findCompanyLink(tokens.userId)).disabledAt).toBeInstanceOf(Date);

            // a run that finds the entry disabled again does nothing again
            await runDisabledEntriesJob();
            const ended: unknown[] = (await auditEvents()).filter(event => JsonUtilities.stringify(event) === JsonUtilities.stringify({
                action: AuditAction.ACCESS_ENDED,
                outcome: AuditOutcome.SUCCESS,
                userId: tokens.userId
            }));
            expect(ended).toHaveLength(1);

            entry.attributes['nsAccountLock'] = ['FALSE'];
            await authDataOf(await signIn({ username: 'tina', password: 'tina-secret' }));
            expect((await findCompanyLink(tokens.userId)).disabledAt ?? undefined).toBeUndefined();
        });
    });
});