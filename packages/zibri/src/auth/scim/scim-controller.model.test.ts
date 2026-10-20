import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { BaseScimProvisioner } from './base-scim-provisioner.ts';
import { ScimController } from './scim-controller.model.ts';
import { ScimFilterUtilities } from './scim-filter.utilities.ts';
import { ScimGroupMember } from './scim-group-member.model.ts';
import { ScimGroupResource } from './scim-group-resource.model.ts';
import { ScimGroup } from './scim-group.model.ts';
import { ScimSchema } from './scim-schema.enum.ts';
import { ScimUserResource } from './scim-user-resource.model.ts';
import { ScimUserValue } from './scim-user-value.model.ts';
import { ScimUser } from './scim-user.model.ts';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../__testing__/mocks/entities/roles.enum.ts';
import { TestMembership } from '../../__testing__/mocks/entities/test-membership.entity.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { Transaction } from '../../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { GlobalRegistry } from '../../global/global-registry.ts';
import { KnownHeader } from '../../http/known-header.enum.ts';
import { AuditAction, AuditOutcome } from '../../logging/audit-event.model.ts';
import { Log } from '../../logging/log.model.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface.ts';
import { Newable } from '../../types/newable.type.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { type AuthServiceInterface } from '../auth-service.interface.ts';
import { ApiKeyAuthStrategy } from '../strategies/api-key/api-key.auth-strategy.ts';
import { ApiKey } from '../strategies/api-key/api-key.model.ts';
import { AuthStrategies } from '../strategies/auth-strategies.model.ts';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy.ts';

/**
 * What a SCIM answer holds.
 */
type ScimAnswer = {
    status: number,
    contentType: string | null,
    headers: Headers,
    body: Record<string, unknown>
};

/**
 * The users of the running application.
 * @returns Their repository.
 */
function users(): Repository<JwtUser> {
    return inject(repositoryTokenFor(JwtUser));
}

/**
 * The memberships of the running application.
 * @returns Their repository.
 */
function memberships(): DefaultTestServerMembershipRepository {
    return inject(DefaultTestServerMembershipRepository);
}

/**
 * The tenant service of the running application.
 * @returns The service.
 */
function tenants(): TenantServiceInterface {
    return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
}

/**
 * Makes a provisioned user a user of the application by their userName, finding one who has it as
 * their email already, gives them the ADMIN role in the tenant while they are in the group "admins",
 * and deletes them when the identity provider does.
 */
class TestScimProvisioner extends BaseScimProvisioner<Roles, JwtUser, TestMembership> {
    async findProvisionedUser(resource: ScimUserResource, transaction: Transaction): Promise<JwtUser | undefined> {
        return await users().findOne({ where: { email: resource.userName.toLowerCase() }, transaction, required: false });
    }

    async createProvisionedUser(resource: ScimUserResource, transaction: Transaction): Promise<JwtUser> {
        return await users().create({ email: resource.userName.toLowerCase(), roles: [Roles.USER] }, { transaction });
    }

    async resolveUpdatedUser(resource: ScimUserResource, user: JwtUser, transaction: Transaction): Promise<void> {
        await users().updateById(user.id, { email: resource.userName.toLowerCase() }, { transaction });
    }

    async resolveGroupMembership(membership: TestMembership, groups: ScimGroupResource[], transaction: Transaction): Promise<void> {
        const roles: Roles[] = groups.some(group => group.displayName === 'admins') ? [Roles.USER, Roles.ADMIN] : [Roles.USER];
        await memberships().updateById(membership.id, { roles }, { transaction });
    }

    async resolveDeletedUser(user: JwtUser, transaction: Transaction): Promise<void> {
        await users().deleteById(user.id, { transaction });
    }
}

/**
 * The most operations a bulk request of the tests may hold.
 */
const MAX_BULK_OPERATIONS: number = 5;

/**
 * The entities SCIM keeps its resources in.
 */
const SCIM_ENTITIES: Newable<BaseEntity>[] = [ScimUser, ScimUserValue, ScimGroup, ScimGroupMember];

@Controller('/scim/v2')
class TestScimController extends ScimController(TestScimProvisioner, { roles: [Roles.ADMIN], bulk: { maxOperations: MAX_BULK_OPERATIONS } }) {}

/**
 * The tenant the identity provider of the tests provisions for.
 */
const TENANT: string = UUIDUtilities.generate();

/**
 * Another tenant, with an identity provider of its own.
 */
const OTHER_TENANT: string = UUIDUtilities.generate();

let server: StartedTestServer | undefined;
let baseUrl: string;
let token: string;
let otherToken: string;

/**
 * Creates the account an identity provider provisions a tenant with: a member of it holding ADMIN
 * there, and an api key bound to it.
 * @param name - What sets the account's email apart.
 * @param tenantId - The tenant.
 * @returns The key, as the identity provider sends it.
 */
async function createProvisioningKey(name: string, tenantId: string): Promise<string> {
    const account: JwtUser = await users().create({ email: `${name}@idp.test`, roles: [] });
    await tenants().runAs(tenantId, async () => await memberships().create({ tenantId, userId: account.id, roles: [Roles.ADMIN] }));
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    return (await authService.createApiKey(
        account.id,
        { name, roles: [Roles.ADMIN], expiresAt: undefined, tenantId, clientAuthentication: undefined, requireDpop: false },
        undefined
    )).key;
}

/**
 * The membership a user holds in a tenant, deactivated or not.
 * @param userName - The userName the user was provisioned with.
 * @param tenantId - The tenant.
 * @returns The membership, if they have one.
 */
async function findMembership(userName: string, tenantId: string = TENANT): Promise<TestMembership | undefined> {
    const user: JwtUser = await appUser(userName);
    return await tenants().runAs(tenantId, async () => await memberships().findMembership(user.id));
}

/**
 * The roles a user holds in a tenant.
 * @param userName - The userName the user was provisioned with.
 * @returns The roles of their membership, if they have one.
 */
async function memberRoles(userName: string): Promise<Roles[] | undefined> {
    return (await findMembership(userName))?.roles;
}

/**
 * Starts an application keeping its data in memory.
 * @param authStrategies - The strategies it reads requests with.
 * @param entities - The entities it declares beside the default ones.
 * @returns The server, started.
 */
async function startApp(authStrategies: AuthStrategies, entities: Newable<BaseEntity>[]): Promise<StartedTestServer> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [...defaultTestServerEntities, ApiKey, ...entities],
        allowOrphan: true
    });
    return await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies,
        controllers: [TestScimController],
        providers: defaultTestServerProviders
    });
}

/**
 * Calls a SCIM route the way an identity provider does.
 * @param method - The http method.
 * @param path - The route below /scim/v2.
 * @param body - The body, if any.
 * @param bearer - The token to send, or false for none. The provisioning account's by default.
 * @param headers - Headers to send beside them.
 * @returns The answer.
 */
async function scim(
    method: string,
    path: string,
    body?: unknown,
    bearer: string | false = token,
    headers: Record<string, string> = {}
): Promise<ScimAnswer> {
    const res: Response = await fetch(`${baseUrl}/scim/v2${path}`, {
        method,
        headers: {
            [KnownHeader.ACCEPT]: 'application/scim+json',
            ...body == undefined ? {} : { [KnownHeader.CONTENT_TYPE]: 'application/scim+json' },
            ...bearer === false ? {} : { [KnownHeader.AUTHORIZATION]: `Bearer ${bearer}` },
            ...headers
        },
        body: body == undefined ? undefined : JsonUtilities.stringify(body)
    });
    const text: string = await res.text();
    const parsed: unknown = text ? JsonUtilities.parse(text) : {};
    return {
        status: res.status,
        contentType: res.headers.get(KnownHeader.CONTENT_TYPE),
        headers: res.headers,
        body: ScimFilterUtilities.isRecord(parsed) ? parsed : {}
    };
}

/**
 * The url the locations of the resources start with: the application's baseUrl and the path of the
 * routes, which is not where the test reaches them.
 * @returns The url.
 */
function scimUrl(): string {
    return `${GlobalRegistry.getAppData('baseUrl') ?? ''}/scim/v2`;
}

/**
 * Finds users by a filter.
 * @param filter - The filter.
 * @param query - What else the request asks, eg. `&sortBy=userName`.
 * @returns The userNames found, in the order they were answered in.
 */
async function userNamesWhere(filter: string, query: string = ''): Promise<unknown[]> {
    const answer: ScimAnswer = await scim('GET', `/Users?filter=${encodeURIComponent(filter)}${query}`);
    expect(answer.status).toBe(200);
    const resources: unknown = answer.body['Resources'];
    return Array.isArray(resources) ? resources.map((resource: unknown) => ScimFilterUtilities.isRecord(resource) ? resource['userName'] : undefined) : [];
}

/**
 * Provisions a group.
 * @param displayName - Its name.
 * @param memberIds - The ids of its members, users or groups.
 * @returns The group resource.
 */
async function provisionGroup(displayName: string, memberIds: unknown[]): Promise<Record<string, unknown>> {
    const answer: ScimAnswer = await scim('POST', '/Groups', { schemas: [ScimSchema.GROUP], displayName, members: memberIds.map(value => ({ value })) });
    expect(answer.status).toBe(201);
    return answer.body;
}

/**
 * Provisions a user.
 * @param userName - Their userName.
 * @param extra - Attributes beside it.
 * @returns The user resource.
 */
async function provisionUser(userName: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const answer: ScimAnswer = await scim('POST', '/Users', { schemas: [ScimSchema.USER], userName, ...extra });
    expect(answer.status).toBe(201);
    return answer.body;
}

/**
 * The user of the application a userName was provisioned as.
 * @param userName - The userName.
 * @returns The user.
 */
async function appUser(userName: string): Promise<JwtUser> {
    return await users().findOne({ where: { email: userName.toLowerCase() } });
}

/**
 * A patch request.
 * @param operations - Its operations.
 * @returns The body.
 */
function patchOp(...operations: unknown[]): unknown {
    return { schemas: [ScimSchema.PATCH_OP], Operations: operations };
}

/**
 * What the audit trail recorded.
 * @returns Whatever each entry carries under `context.metadata.audit`.
 */
async function auditEvents(): Promise<unknown[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    // across tenants: what the identity provider did is logged in its tenant
    return (await inject(repositoryTokenFor(Log)).findAll({ acrossTenants: true })).map(l => l.context.metadata?.['audit']);
}

describe('ScimController — starting', () => {
    it('refuses to start without ApiKeyAuthStrategy', async () => {
        await expect(startApp([JwtAuthStrategy], SCIM_ENTITIES)).rejects.toThrow('SCIM needs ApiKeyAuthStrategy');
    }, 30000);

    it('refuses to start without its entities, and names them', async () => {
        await expect(startApp([JwtAuthStrategy, ApiKeyAuthStrategy], [])).rejects.toThrow(/ScimService[\S\s]*ScimUser/);
    }, 30000);

    it('starts with a strategy extending ApiKeyAuthStrategy, and provisions through its keys', async () => {
        class CompanyApiKeyAuthStrategy<Role extends string> extends ApiKeyAuthStrategy<Role> {}
        server = await startApp([JwtAuthStrategy, CompanyApiKeyAuthStrategy], SCIM_ENTITIES);
        try {
            baseUrl = await server.start();
            token = await createProvisioningKey('company-provisioning', TENANT);

            expect((await scim('GET', '/Users')).status).toBe(200);
        }
        finally {
            await server.shutdown();
        }
    }, 30000);
});

describe('ScimController', () => {
    beforeAll(async () => {
        server = await startApp([JwtAuthStrategy, ApiKeyAuthStrategy], SCIM_ENTITIES);
        baseUrl = await server.start();
        token = await createProvisioningKey('provisioning', TENANT);
        otherToken = await createProvisioningKey('other-provisioning', OTHER_TENANT);
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('provisions a user, who becomes a user of the application, and answers in scim json', async () => {
        const answer: ScimAnswer = await scim('POST', '/Users', {
            schemas: [ScimSchema.USER, ScimSchema.ENTERPRISE_USER],
            userName: 'Anna@Corp.test',
            externalId: 'entra-1',
            name: { givenName: 'Anna', familyName: 'Berg' },
            emails: [{ value: 'anna@corp.test', type: 'work', primary: true }],
            [ScimSchema.ENTERPRISE_USER]: { department: 'Sales' },
            password: 'never kept'
        });

        expect(answer.status).toBe(201);
        expect(answer.contentType).toMatch(/^application\/scim\+json/);
        expect(answer.body).toMatchObject({
            schemas: [ScimSchema.USER, ScimSchema.ENTERPRISE_USER],
            userName: 'Anna@Corp.test',
            externalId: 'entra-1',
            active: true,
            name: { givenName: 'Anna', familyName: 'Berg' },
            [ScimSchema.ENTERPRISE_USER]: { department: 'Sales' },
            meta: { resourceType: 'User' }
        });
        expect(answer.body).not.toHaveProperty('password');
        expect((await appUser('anna@corp.test')).roles).toEqual([Roles.USER]);
        // a member of the tenant, with the roles their groups give, of which they have none yet
        expect(await memberRoles('anna@corp.test')).toEqual([Roles.USER]);
        expect((await scim('GET', `/Users/${String(answer.body['id'])}`)).body).toEqual(answer.body);
    });

    it('finds users by the filters identity providers send, and refuses one it cannot answer', async () => {
        const created: Record<string, unknown> = await provisionUser('bob@corp.test', { externalId: 'entra-2' });

        const byName: ScimAnswer = await scim('GET', `/Users?filter=${encodeURIComponent('userName eq "BOB@corp.test"')}`);
        const byExternalId: ScimAnswer = await scim('GET', `/Users?filter=${encodeURIComponent('externalId eq "entra-2" or userName eq "nobody"')}`);
        const none: ScimAnswer = await scim('GET', `/Users?filter=${encodeURIComponent('userName eq "nobody@corp.test"')}`);
        const unsupported: ScimAnswer = await scim('GET', `/Users?filter=${encodeURIComponent('groups.type eq "direct"')}`);

        expect(byName.body).toMatchObject({ schemas: [ScimSchema.LIST_RESPONSE], totalResults: 1, Resources: [{ id: created['id'] }] });
        expect(byExternalId.body).toMatchObject({ totalResults: 1, Resources: [{ id: created['id'] }] });
        expect(none.body).toMatchObject({ totalResults: 0, Resources: [] });
        expect(unsupported.status).toBe(400);
        expect(unsupported.contentType).toMatch(/^application\/scim\+json/);
        expect(unsupported.body).toMatchObject({ schemas: [ScimSchema.ERROR], status: '400', scimType: 'invalidFilter' });
    });

    it('pages through the users, and leaves out the attributes a request excludes', async () => {
        await provisionUser('page-1@corp.test');
        await provisionUser('page-2@corp.test');

        const first: ScimAnswer = await scim('GET', `/Users?filter=${encodeURIComponent('userName eq "page-1@corp.test" or userName eq "page-2@corp.test"')}&startIndex=1&count=1&excludedAttributes=meta`);
        const second: ScimAnswer = await scim('GET', `/Users?filter=${encodeURIComponent('userName eq "page-1@corp.test" or userName eq "page-2@corp.test"')}&startIndex=2&count=1`);

        expect(first.body).toMatchObject({ totalResults: 2, startIndex: 1, itemsPerPage: 1, Resources: [{ userName: 'page-1@corp.test' }] });
        expect(first.body['Resources']).toEqual([expect.not.objectContaining({ meta: expect.anything() })]);
        expect(second.body).toMatchObject({ totalResults: 2, startIndex: 2, itemsPerPage: 1, Resources: [{ userName: 'page-2@corp.test' }] });
    });

    it('refuses a second user of the same userName, in any case', async () => {
        await provisionUser('carla@corp.test');

        const answer: ScimAnswer = await scim('POST', '/Users', { schemas: [ScimSchema.USER], userName: 'CARLA@corp.test' });

        expect(answer.status).toBe(409);
        expect(answer.body).toMatchObject({ status: '409', scimType: 'uniqueness' });
    });

    it('deactivates a user the identity provider sets inactive, ending their access, and reactivates them', async () => {
        const created: Record<string, unknown> = await provisionUser('dave@corp.test');
        const dave: JwtUser = await appUser('dave@corp.test');
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const key: string = (await authService.createApiKey(
            dave.id,
            { name: 'script', roles: [Roles.USER], expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
            undefined
        )).key;

        // as Entra ID sends it: the operation capitalized and the boolean a string
        const deactivated: ScimAnswer = await scim('PATCH', `/Users/${String(created['id'])}`, patchOp({ op: 'Replace', path: 'active', value: 'False' }));

        expect(deactivated.body).toMatchObject({ active: false });
        expect((await users().findById(dave.id)).deactivatedAt).toBeInstanceOf(Date);
        expect(await authService.findApiKeys(dave.id, undefined)).toEqual([]);
        expect((await scim('GET', '/ServiceProviderConfig', undefined, key)).status).toBe(401);

        const reactivated: ScimAnswer = await scim('PATCH', `/Users/${String(created['id'])}`, patchOp({ op: 'replace', value: { active: true } }));

        expect(reactivated.body).toMatchObject({ active: true });
        expect((await users().findById(dave.id)).deactivatedAt).toBeFalsy();
    });

    it('deactivates a user provisioned inactive', async () => {
        await provisionUser('erin@corp.test', { active: false });

        expect((await appUser('erin@corp.test')).deactivatedAt).toBeInstanceOf(Date);
    });

    it('changes the user of the application when the identity provider replaces their resource', async () => {
        const created: Record<string, unknown> = await provisionUser('frank@corp.test', { title: 'Engineer' });
        const frank: JwtUser = await appUser('frank@corp.test');

        const replaced: ScimAnswer = await scim('PUT', `/Users/${String(created['id'])}`, {
            schemas: [ScimSchema.USER],
            userName: 'franklin@corp.test',
            active: true
        });

        expect(replaced.body).toMatchObject({ userName: 'franklin@corp.test' });
        expect(replaced.body).not.toHaveProperty('title');
        expect((await appUser('franklin@corp.test')).id).toBe(frank.id);
    });

    it('gives users their roles from their groups, as members are added and removed', async () => {
        const gina: Record<string, unknown> = await provisionUser('gina@corp.test');
        const hank: Record<string, unknown> = await provisionUser('hank@corp.test');
        const group: ScimAnswer = await scim('POST', '/Groups', {
            schemas: [ScimSchema.GROUP],
            displayName: 'admins',
            externalId: 'entra-group-1',
            members: [{ value: gina['id'] }]
        });
        expect(group.status).toBe(201);
        expect(group.body).toMatchObject({ displayName: 'admins', members: [{ value: gina['id'], display: 'gina@corp.test' }] });
        expect(await memberRoles('gina@corp.test')).toEqual([Roles.USER, Roles.ADMIN]);
        // the roles of the membership, never the user's own
        expect((await appUser('gina@corp.test')).roles).toEqual([Roles.USER]);

        const groupId: string = String(group.body['id']);
        await scim('PATCH', `/Groups/${groupId}`, patchOp({ op: 'Add', path: 'members', value: [{ value: hank['id'] }] }));
        expect(await memberRoles('hank@corp.test')).toEqual([Roles.USER, Roles.ADMIN]);

        await scim('PATCH', `/Groups/${groupId}`, patchOp({ op: 'Remove', path: `members[value eq "${String(gina['id'])}"]` }));
        expect(await memberRoles('gina@corp.test')).toEqual([Roles.USER]);

        const withoutMembers: ScimAnswer = await scim('GET', `/Groups/${groupId}?excludedAttributes=members`);
        expect(withoutMembers.body).not.toHaveProperty('members');
        const memberFilter: string = `displayName eq "ADMINS" and members[value eq "${String(hank['id'])}"]`;
        const byMember: ScimAnswer = await scim('GET', `/Groups?filter=${encodeURIComponent(memberFilter)}`);
        expect(byMember.body).toMatchObject({ totalResults: 1, Resources: [{ id: groupId }] });

        expect((await scim('DELETE', `/Groups/${groupId}`)).status).toBe(204);
        expect(await memberRoles('hank@corp.test')).toEqual([Roles.USER]);
    });

    it('refuses a member that is no provisioned user', async () => {
        const answer: ScimAnswer = await scim('POST', '/Groups', { displayName: 'ghosts', members: [{ value: '8a0f7c1e-3b9d-4e2a-9c61-0d5f3e7b2a14' }] });

        expect(answer.status).toBe(400);
        expect(answer.body).toMatchObject({ scimType: 'invalidValue' });
    });

    it('deletes a user through the provisioner, deactivated first, and forgets their resource', async () => {
        const ivy: Record<string, unknown> = await provisionUser('ivy@corp.test');
        const group: ScimAnswer = await scim('POST', '/Groups', { displayName: 'staff', members: [{ value: ivy['id'] }] });

        const deleted: ScimAnswer = await scim('DELETE', `/Users/${String(ivy['id'])}`);

        expect(deleted.status).toBe(204);
        expect(await users().findOne({ where: { email: 'ivy@corp.test' }, required: false })).toBeUndefined();
        const gone: ScimAnswer = await scim('GET', `/Users/${String(ivy['id'])}`);
        expect(gone.status).toBe(404);
        expect(gone.body).toMatchObject({ schemas: [ScimSchema.ERROR], status: '404' });
        expect((await scim('GET', `/Groups/${String(group.body['id'])}`)).body).toMatchObject({ members: [] });
    });

    it('answers an id that is none with a 404', async () => {
        expect((await scim('GET', '/Users/not-an-id')).status).toBe(404);
        expect((await scim('PATCH', '/Groups/8a0f7c1e-3b9d-4e2a-9c61-0d5f3e7b2a14', patchOp({ op: 'replace', path: 'displayName', value: 'x' }))).status).toBe(404);
    });

    it('lets only an api key of a user holding the role provision', async () => {
        const jack: JwtUser = await users().create({ email: 'jack@corp.test', roles: [Roles.USER] });
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const userKey: string = (await authService.createApiKey(
            jack.id,
            { name: 'script', roles: [Roles.USER], expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
            undefined
        )).key;

        expect((await scim('GET', '/Users', undefined, false)).status).toBe(401);
        expect((await scim('GET', '/Users', undefined, userKey)).status).toBe(403);

        // a member of the tenant, and its key bound to it, but without the role there
        await tenants().runAs(TENANT, async () => await memberships().create({ tenantId: TENANT, userId: jack.id, roles: [Roles.USER] }));
        const memberKey: string = (await authService.createApiKey(
            jack.id,
            { name: 'member', roles: [Roles.USER], expiresAt: undefined, tenantId: TENANT, clientAuthentication: undefined, requireDpop: false },
            undefined
        )).key;
        expect((await scim('GET', '/Users', undefined, memberKey)).status).toBe(403);
        // and the identity provider of one tenant cannot name another
        expect((await scim('GET', '/Users', undefined, token, { 'x-tenant-id': OTHER_TENANT })).status).toBe(403);
    });

    it('keeps the resources of each tenant apart, the same userName in both', async () => {
        const ours: Record<string, unknown> = await provisionUser('apart@corp.test');
        const theirs: ScimAnswer = await scim('POST', '/Users', { schemas: [ScimSchema.USER], userName: 'apart@corp.test' }, otherToken);
        expect(theirs.status).toBe(201);

        expect(theirs.body['id']).not.toBe(ours['id']);
        expect(await userNamesWhere('userName eq "apart@corp.test"')).toEqual(['apart@corp.test']);
        expect((await scim('GET', `/Users/${String(ours['id'])}`, undefined, otherToken)).status).toBe(404);
        expect((await scim('DELETE', `/Users/${String(ours['id'])}`, undefined, otherToken)).status).toBe(404);
        // one user of the application, a member of both
        expect((await findMembership('apart@corp.test'))?.tenantId).toBe(TENANT);
        expect((await findMembership('apart@corp.test', OTHER_TENANT))?.tenantId).toBe(OTHER_TENANT);
    });

    it('reaches only the membership of a user it did not create, never the user', async () => {
        // a user the application had before any identity provider sent them
        const existing: JwtUser = await users().create({ email: 'existing@corp.test', roles: [Roles.USER] });
        const created: Record<string, unknown> = await provisionUser('existing@corp.test');
        const id: string = String(created['id']);

        await scim('PATCH', `/Users/${id}`, patchOp({ op: 'replace', path: 'active', value: false }));
        expect((await users().findById(existing.id)).deactivatedAt).toBeFalsy();
        expect((await findMembership('existing@corp.test'))?.deactivatedAt).toBeInstanceOf(Date);

        await scim('PATCH', `/Users/${id}`, patchOp({ op: 'replace', path: 'active', value: true }));
        expect((await findMembership('existing@corp.test'))?.deactivatedAt).toBeFalsy();

        // a userName it renames is no email it may change: the user may belong to other tenants too
        const renamed: ScimAnswer = await scim('PUT', `/Users/${id}`, { schemas: [ScimSchema.USER], userName: 'taken-over@corp.test' });
        expect(renamed.body).toMatchObject({ userName: 'taken-over@corp.test' });
        expect((await users().findById(existing.id)).email).toBe('existing@corp.test');

        expect((await scim('DELETE', `/Users/${id}`)).status).toBe(204);
        expect((await users().findById(existing.id)).deactivatedAt).toBeFalsy();
        expect(await findMembership('existing@corp.test')).toBeUndefined();
    });

    it('deactivates and deletes a user it created in every tenant, as for somebody who left the company', async () => {
        const created: Record<string, unknown> = await provisionUser('leaver@corp.test');
        // the identity provider of a customer finds them, and makes them a member there
        await scim('POST', '/Users', { schemas: [ScimSchema.USER], userName: 'leaver@corp.test' }, otherToken);
        const leaver: JwtUser = await appUser('leaver@corp.test');
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const customerKey: string = (await authService.createApiKey(
            leaver.id,
            { name: 'customer', roles: [Roles.USER], expiresAt: undefined, tenantId: OTHER_TENANT, clientAuthentication: undefined, requireDpop: false },
            undefined
        )).key;

        await scim('PATCH', `/Users/${String(created['id'])}`, patchOp({ op: 'replace', path: 'active', value: false }));

        expect((await users().findById(leaver.id)).deactivatedAt).toBeInstanceOf(Date);
        expect((await scim('GET', '/ServiceProviderConfig', undefined, customerKey)).status).toBe(401);

        expect((await scim('DELETE', `/Users/${String(created['id'])}`)).status).toBe(204);

        expect(await users().findOne({ where: { id: leaver.id }, required: false })).toBeUndefined();
        expect(await tenants().runAs(OTHER_TENANT, async () => await memberships().findMembership(leaver.id))).toBeUndefined();
        expect(await userNamesWhere('userName eq "leaver@corp.test"')).toEqual([]);
    });

    it('says what it supports, and which resources it keeps', async () => {
        const config: ScimAnswer = await scim('GET', '/ServiceProviderConfig');
        const types: ScimAnswer = await scim('GET', '/ResourceTypes');

        expect(config.body).toMatchObject({
            schemas: [ScimSchema.SERVICE_PROVIDER_CONFIG],
            patch: { supported: true },
            filter: { supported: true },
            sort: { supported: true },
            etag: { supported: true },
            bulk: { supported: true, maxOperations: MAX_BULK_OPERATIONS, maxPayloadSize: 1024 * 1024 },
            meta: { location: `${scimUrl()}/ServiceProviderConfig` }
        });
        expect(types.body).toMatchObject({ totalResults: 2, Resources: [{ id: 'User', endpoint: '/Users' }, { id: 'Group', endpoint: '/Groups' }] });
        expect((await scim('GET', '/ResourceTypes/Group')).body).toMatchObject({ id: 'Group', schema: ScimSchema.GROUP });
        expect((await scim('GET', '/ResourceTypes/Device')).status).toBe(404);
    });

    it('describes the attributes of the resources it keeps', async () => {
        const schemas: ScimAnswer = await scim('GET', '/Schemas');
        const user: ScimAnswer = await scim('GET', `/Schemas/${ScimSchema.USER}`);

        expect(schemas.body).toMatchObject({
            totalResults: 3,
            Resources: [{ id: ScimSchema.USER }, { id: ScimSchema.ENTERPRISE_USER }, { id: ScimSchema.GROUP }]
        });
        expect(user.body).toMatchObject({
            schemas: [ScimSchema.SCHEMA],
            name: 'User',
            meta: { resourceType: 'Schema', location: `${scimUrl()}/Schemas/${ScimSchema.USER}` }
        });
        expect(user.body['attributes']).toContainEqual(expect.objectContaining({ name: 'userName', required: true, uniqueness: 'server' }));
        expect((await scim('GET', '/Schemas/urn:example:Device')).status).toBe(404);
    });

    it('answers a resource with its location and version, and changes it only in the version a request names', async () => {
        const created: ScimAnswer = await scim('POST', '/Users', { userName: 'versioned@corp.test' });
        const id: string = String(created.body['id']);
        const location: string = `${scimUrl()}/Users/${id}`;
        expect(created.headers.get(KnownHeader.LOCATION)).toBe(location);
        expect(created.headers.get(KnownHeader.ETAG)).toBe('W/"1"');
        expect(created.body).toMatchObject({ meta: { location, version: 'W/"1"' } });

        // the cache control a revalidating client sends, which fetch would otherwise make no-cache
        const unchanged: ScimAnswer = await scim('GET', `/Users/${id}`, undefined, token, {
            [KnownHeader.CACHE_CONTROL]: 'max-age=0',
            [KnownHeader.IF_NONE_MATCH]: 'W/"1"'
        });
        expect(unchanged.status).toBe(304);

        const rename: unknown = patchOp({ op: 'replace', path: 'displayName', value: 'Versioned' });
        const stale: ScimAnswer = await scim('PATCH', `/Users/${id}`, rename, token, { [KnownHeader.IF_MATCH]: 'W/"7"' });
        expect(stale.status).toBe(412);
        expect(stale.body).toMatchObject({ schemas: [ScimSchema.ERROR], status: '412' });

        const changed: ScimAnswer = await scim('PATCH', `/Users/${id}`, rename, token, { [KnownHeader.IF_MATCH]: 'W/"1"' });
        expect(changed.status).toBe(200);
        expect(changed.headers.get(KnownHeader.ETAG)).toBe('W/"2"');
        expect((await scim('GET', `/Users/${id}`)).body).toMatchObject({ displayName: 'Versioned', meta: { version: 'W/"2"' } });

        expect((await scim('DELETE', `/Users/${id}`, undefined, token, { [KnownHeader.IF_MATCH]: 'W/"1"' })).status).toBe(412);
        expect((await scim('DELETE', `/Users/${id}`, undefined, token, { [KnownHeader.IF_MATCH]: '*' })).status).toBe(204);
    });

    it('finds users by every operator, a not and a value with a wildcard in it included', async () => {
        await provisionUser('op-alpha@corp.test', { externalId: 'x-1' });
        // apart from both sides by a millisecond at least, which an application in memory is faster than
        await sleep(2);
        const before: string = new Date().toISOString();
        await sleep(2);
        await provisionUser('op-beta@corp.test');
        await provisionUser('op-50%@corp.test', { active: false });
        const ours: string = 'userName sw "op-"';

        expect(await userNamesWhere(`${ours} and userName co "ALPHA"`)).toEqual(['op-alpha@corp.test']);
        expect(await userNamesWhere('userName ew "BETA@corp.test"')).toEqual(['op-beta@corp.test']);
        // the % and the _ are characters of the name, not wildcards
        await provisionUser('esc-5000@corp.test');
        await provisionUser('esc_a@corp.test');
        expect(await userNamesWhere('userName co "50%"')).toEqual(['op-50%@corp.test']);
        expect(await userNamesWhere('userName sw "esc_"')).toEqual(['esc_a@corp.test']);
        expect(await userNamesWhere(`${ours} and not (userName co "alpha")`)).toEqual(['op-beta@corp.test', 'op-50%@corp.test']);
        expect(await userNamesWhere(`${ours} and userName gt "op-alpha@corp.test"`)).toEqual(['op-beta@corp.test']);
        expect(await userNamesWhere(`${ours} and userName le "op-alpha@corp.test"`)).toEqual(['op-alpha@corp.test', 'op-50%@corp.test']);
        expect(await userNamesWhere(`${ours} and externalId pr`)).toEqual(['op-alpha@corp.test']);
        expect(await userNamesWhere(`${ours} and not (externalId pr)`)).toEqual(['op-beta@corp.test', 'op-50%@corp.test']);
        expect(await userNamesWhere(`${ours} and externalId ne "x-1"`)).toEqual(['op-beta@corp.test', 'op-50%@corp.test']);
        expect(await userNamesWhere(`${ours} and active eq false`)).toEqual(['op-50%@corp.test']);
        expect(await userNamesWhere(`${ours} and meta.created ge "${before}"`)).toEqual(['op-beta@corp.test', 'op-50%@corp.test']);

        const greaterThanABoolean: ScimAnswer = await scim('GET', `/Users?filter=${encodeURIComponent('active gt true')}`);
        expect(greaterThanABoolean.body).toMatchObject({ status: '400', scimType: 'invalidFilter' });
    });

    it('sorts users by an attribute, ascending or descending, with the ones that have no value of it last when ascending', async () => {
        await provisionUser('sort-a@corp.test', { externalId: 'b' });
        await provisionUser('sort-b@corp.test', { externalId: 'a' });
        await provisionUser('sort-c@corp.test');
        const ours: string = 'userName sw "sort-"';

        expect(await userNamesWhere(ours, '&sortBy=userName&sortOrder=descending'))
            .toEqual(['sort-c@corp.test', 'sort-b@corp.test', 'sort-a@corp.test']);
        expect(await userNamesWhere(ours, '&sortBy=externalId'))
            .toEqual(['sort-b@corp.test', 'sort-a@corp.test', 'sort-c@corp.test']);
        expect(await userNamesWhere(ours, '&sortBy=externalId&sortOrder=descending'))
            .toEqual(['sort-c@corp.test', 'sort-a@corp.test', 'sort-b@corp.test']);

        const byId: ScimAnswer = await scim('GET', `/Users?filter=${encodeURIComponent(ours)}&sortBy=id&sortOrder=descending`);
        const ids: unknown[] = Array.isArray(byId.body['Resources'])
            ? byId.body['Resources'].map((resource: unknown) => ScimFilterUtilities.isRecord(resource) ? resource['id'] : undefined)
            : [];
        expect(ids).toEqual(ids.map(String).sort((a, b) => b.localeCompare(a)));

        const byGroups: ScimAnswer = await scim('GET', '/Users?sortBy=groups');
        expect(byGroups.body).toMatchObject({ status: '400', scimType: 'invalidValue' });
    });

    it('finds users by any attribute they were provisioned with, the sub-attributes of one value together', async () => {
        const pia: Record<string, unknown> = await provisionUser('val-pia@corp.test', {
            name: { givenName: 'Pia', familyName: 'Wood' },
            emails: [{ value: 'zz-pia@home.test', type: 'home' }, { value: 'pia@corp.test', type: 'work', primary: true }],
            title: 'Engineer',
            loginCount: 5,
            [ScimSchema.ENTERPRISE_USER]: { employeeNumber: '701' }
        });
        const ron: Record<string, unknown> = await provisionUser('val-ron@corp.test', {
            name: { givenName: 'Ron', familyName: 'Adams' },
            emails: [{ value: 'ron@corp.test', type: 'home' }],
            title: 'Designer',
            loginCount: 2
        });
        await provisionUser('val-sue@corp.test', { emails: [{ value: 'sue@corp.test', type: 'work' }] });
        const ours: string = 'userName sw "val-"';

        expect(await userNamesWhere('name.givenName sw "p"')).toEqual(['val-pia@corp.test']);
        expect(await userNamesWhere('name.familyName eq "ADAMS"')).toEqual(['val-ron@corp.test']);
        expect(await userNamesWhere(`${ours} and emails.value ew "@corp.test"`)).toEqual(['val-pia@corp.test', 'val-ron@corp.test', 'val-sue@corp.test']);
        // the type and the value of one email, not of any two
        expect(await userNamesWhere(`${ours} and emails[type eq "work" and value co "corp"]`)).toEqual(['val-pia@corp.test', 'val-sue@corp.test']);
        expect(await userNamesWhere(`${ours} and emails[type eq "home" and value co "corp"]`)).toEqual(['val-ron@corp.test']);
        expect(await userNamesWhere(`${ours} and emails[not (type eq "home")]`)).toEqual(['val-pia@corp.test', 'val-sue@corp.test']);
        expect(await userNamesWhere('emails eq "SUE@corp.test"')).toEqual(['val-sue@corp.test']);
        expect(await userNamesWhere(`${ours} and title ne "engineer"`)).toEqual(['val-ron@corp.test', 'val-sue@corp.test']);
        expect(await userNamesWhere(`${ours} and name pr`)).toEqual(['val-pia@corp.test', 'val-ron@corp.test']);
        expect(await userNamesWhere(`${ours} and not (name pr)`)).toEqual(['val-sue@corp.test']);
        expect(await userNamesWhere(`${ours} and name.familyName eq null`)).toEqual(['val-sue@corp.test']);
        expect(await userNamesWhere(`${ScimSchema.ENTERPRISE_USER}:employeeNumber eq "701"`)).toEqual(['val-pia@corp.test']);
        expect(await userNamesWhere('loginCount gt 3')).toEqual(['val-pia@corp.test']);
        expect((await scim('GET', `/Users?filter=${encodeURIComponent('loginCount co 3')}`)).body).toMatchObject({ scimType: 'invalidFilter' });

        await scim('PUT', `/Users/${String(pia['id'])}`, { userName: 'val-pia@corp.test', name: { familyName: 'Wood' } });
        await scim('DELETE', `/Users/${String(ron['id'])}`);
        expect(await userNamesWhere('title eq "engineer"')).toEqual([]);
        expect(await userNamesWhere('name.familyName eq "Adams"')).toEqual([]);
        expect(await userNamesWhere('name.familyName eq "wood"')).toEqual(['val-pia@corp.test']);
    });

    it('sorts users by any attribute, a multi-valued one by its primary value, and pages across those without one', async () => {
        await provisionUser('srt-pia@corp.test', {
            name: { familyName: 'Wood' },
            emails: [{ value: 'zz-pia@home.test' }, { value: 'pia@corp.test', primary: true }]
        });
        await provisionUser('srt-ron@corp.test', { name: { familyName: 'Adams' }, emails: [{ value: 'ron@corp.test' }] });
        await provisionUser('srt-sue@corp.test', { emails: [{ value: 'sue@corp.test' }] });
        const ours: string = 'userName sw "srt-"';

        expect(await userNamesWhere(ours, '&sortBy=name.familyName')).toEqual(['srt-ron@corp.test', 'srt-pia@corp.test', 'srt-sue@corp.test']);
        expect(await userNamesWhere(ours, '&sortBy=name.familyName&sortOrder=descending'))
            .toEqual(['srt-sue@corp.test', 'srt-pia@corp.test', 'srt-ron@corp.test']);
        expect(await userNamesWhere(ours, '&sortBy=emails')).toEqual(['srt-pia@corp.test', 'srt-ron@corp.test', 'srt-sue@corp.test']);
        expect(await userNamesWhere(ours, '&sortBy=name.familyName&startIndex=2&count=2')).toEqual(['srt-pia@corp.test', 'srt-sue@corp.test']);
        expect(await userNamesWhere(ours, '&sortBy=name.familyName&sortOrder=descending&startIndex=2&count=1')).toEqual(['srt-pia@corp.test']);
    });

    it('answers the groups of a user, directly or through other groups, and finds users by them', async () => {
        const tom: Record<string, unknown> = await provisionUser('grp-tom@corp.test');
        await provisionUser('grp-uma@corp.test');
        const inner: Record<string, unknown> = await provisionGroup('grp-inner', [tom['id']]);
        const outer: Record<string, unknown> = await provisionGroup('grp-outer', [inner['id']]);
        const groups: Record<string, unknown>[] = [
            { value: inner['id'], display: 'grp-inner', type: 'direct', $ref: `${scimUrl()}/Groups/${String(inner['id'])}` },
            { value: outer['id'], display: 'grp-outer', type: 'indirect', $ref: `${scimUrl()}/Groups/${String(outer['id'])}` }
        ];

        expect((await scim('GET', `/Users/${String(tom['id'])}`)).body['groups']).toEqual(groups);
        expect((await scim('GET', `/Users/${String(tom['id'])}?excludedAttributes=groups`)).body).not.toHaveProperty('groups');
        // read only: what a request sends is no group
        const replaced: ScimAnswer = await scim('PUT', `/Users/${String(tom['id'])}`, { userName: 'grp-tom@corp.test', groups: [{ value: 'x' }] });
        expect(replaced.body['groups']).toEqual(groups);

        const ours: string = 'userName sw "grp-"';
        expect(await userNamesWhere('groups.display eq "GRP-OUTER"')).toEqual(['grp-tom@corp.test']);
        expect(await userNamesWhere(`groups[value eq "${String(inner['id'])}"]`)).toEqual(['grp-tom@corp.test']);
        expect(await userNamesWhere(`${ours} and not (groups pr)`)).toEqual(['grp-uma@corp.test']);
        expect(await userNamesWhere(`${ours} and groups eq null`)).toEqual(['grp-uma@corp.test']);

        const user: ScimAnswer = await scim('GET', `/Schemas/${ScimSchema.USER}`);
        expect(user.body['attributes']).toContainEqual(expect.objectContaining({ name: 'groups', multiValued: true, mutability: 'readOnly' }));
    });

    it('gives users the roles of groups inside groups, and takes them away when a group leaves', async () => {
        const laura: Record<string, unknown> = await provisionUser('laura@corp.test');
        const staff: Record<string, unknown> = await provisionGroup('nested-staff', [laura['id']]);
        const admins: Record<string, unknown> = await provisionGroup('admins', [staff['id']]);
        expect(await memberRoles('laura@corp.test')).toEqual([Roles.USER, Roles.ADMIN]);
        const staffMember: Record<string, unknown> = {
            value: staff['id'],
            display: 'nested-staff',
            type: 'Group',
            $ref: `${scimUrl()}/Groups/${String(staff['id'])}`
        };
        expect(admins['members']).toEqual([staffMember]);

        const adminsId: string = String(admins['id']);
        await scim('PATCH', `/Groups/${adminsId}`, patchOp({ op: 'remove', path: `members[value eq "${String(staff['id'])}"]` }));
        expect(await memberRoles('laura@corp.test')).toEqual([Roles.USER]);

        // a loop of groups is followed once
        await scim('PATCH', `/Groups/${adminsId}`, patchOp({ op: 'add', path: 'members', value: [{ value: staff['id'] }] }));
        await scim('PATCH', `/Groups/${String(staff['id'])}`, patchOp({ op: 'add', path: 'members', value: [{ value: adminsId }] }));
        expect(await memberRoles('laura@corp.test')).toEqual([Roles.USER, Roles.ADMIN]);

        expect((await scim('DELETE', `/Groups/${adminsId}`)).status).toBe(204);
        expect(await memberRoles('laura@corp.test')).toEqual([Roles.USER]);
    });

    it('changes the version of a group whose member is deleted', async () => {
        const mia: Record<string, unknown> = await provisionUser('mia@corp.test');
        const group: Record<string, unknown> = await provisionGroup('mia-group', [mia['id']]);

        await scim('DELETE', `/Users/${String(mia['id'])}`);

        expect((await scim('GET', `/Groups/${String(group['id'])}`)).body).toMatchObject({ members: [], meta: { version: 'W/"2"' } });
    });

    it('forgets a resource whose user the application deleted, so the identity provider provisions them anew', async () => {
        const nancy: Record<string, unknown> = await provisionUser('nancy@corp.test');
        const group: Record<string, unknown> = await provisionGroup('nancy-group', [nancy['id']]);
        await users().deleteById((await appUser('nancy@corp.test')).id);

        expect(await userNamesWhere('userName eq "nancy@corp.test"')).toEqual([]);
        expect((await scim('GET', `/Users/${String(nancy['id'])}`)).status).toBe(404);
        expect((await scim('GET', `/Groups/${String(group['id'])}`)).body).toMatchObject({ members: [] });

        const again: Record<string, unknown> = await provisionUser('nancy@corp.test');
        expect(again['id']).not.toBe(nancy['id']);
        expect(await memberRoles('nancy@corp.test')).toEqual([Roles.USER]);
    });

    it('applies the operations of a bulk request, those referring to a resource another one creates after it', async () => {
        const answer: ScimAnswer = await scim('POST', '/Bulk', {
            schemas: [ScimSchema.BULK_REQUEST],
            Operations: [
                // refers to the user created by the operation after it
                { method: 'POST', path: '/Groups', bulkId: 'group', data: { displayName: 'admins', members: [{ value: 'bulkId:oscar' }] } },
                { method: 'POST', path: '/Users', bulkId: 'oscar', data: { userName: 'oscar@corp.test' } },
                { method: 'PATCH', path: '/Users/bulkId:oscar', data: patchOp({ op: 'replace', path: 'displayName', value: 'Olaf' }) },
                { method: 'DELETE', path: '/Users/8a0f7c1e-3b9d-4e2a-9c61-0d5f3e7b2a14' }
            ]
        });

        expect(answer.status).toBe(200);
        expect(answer.body['schemas']).toEqual([ScimSchema.BULK_RESPONSE]);
        expect(answer.body['Operations']).toEqual([
            expect.objectContaining({ method: 'POST', bulkId: 'group', status: '201', location: expect.stringContaining('/scim/v2/Groups/') }),
            expect.objectContaining({ method: 'POST', bulkId: 'oscar', status: '201', version: 'W/"1"' }),
            expect.objectContaining({ method: 'PATCH', status: '200', version: 'W/"2"' }),
            expect.objectContaining({ method: 'DELETE', status: '404', response: expect.objectContaining({ schemas: [ScimSchema.ERROR] }) })
        ]);
        expect(await memberRoles('oscar@corp.test')).toEqual([Roles.USER, Roles.ADMIN]);
    });

    it('stops a bulk request after as many errors as it allows, and resolves operations that refer to each other in a circle', async () => {
        const stopped: ScimAnswer = await scim('POST', '/Bulk', {
            schemas: [ScimSchema.BULK_REQUEST],
            failOnErrors: 1,
            Operations: [
                { method: 'POST', path: '/Users', data: { userName: '' } },
                { method: 'POST', path: '/Users', data: { userName: 'never@corp.test' } }
            ]
        });
        expect(stopped.body['Operations']).toEqual([expect.objectContaining({ status: '400' })]);
        expect(await userNamesWhere('userName eq "never@corp.test"')).toEqual([]);

        const circle: ScimAnswer = await scim('POST', '/Bulk', {
            schemas: [ScimSchema.BULK_REQUEST],
            Operations: [
                { method: 'POST', path: '/Groups', bulkId: 'a', data: { displayName: 'circle-a', members: [{ value: 'bulkId:b' }] } },
                { method: 'POST', path: '/Groups', bulkId: 'b', data: { displayName: 'circle-b', members: [{ value: 'bulkId:a' }] } }
            ]
        });
        expect(circle.body['Operations']).toEqual([
            expect.objectContaining({ bulkId: 'a', status: '201', version: 'W/"2"' }),
            expect.objectContaining({ bulkId: 'b', status: '201' })
        ]);
        const [a, b] = await Promise.all(['circle-a', 'circle-b'].map(async name => {
            const filter: string = `displayName eq "${name}"`;
            const found: ScimAnswer = await scim('GET', `/Groups?filter=${encodeURIComponent(filter)}`);
            const resources: unknown = found.body['Resources'];
            return Array.isArray(resources) && ScimFilterUtilities.isRecord(resources[0]) ? resources[0] : {};
        }));
        expect(a).toMatchObject({ members: [{ value: b?.['id'] }] });
        expect(b).toMatchObject({ members: [{ value: a?.['id'] }] });

        // no operation of it creates a resource that could be created first
        const unresolvable: ScimAnswer = await scim('POST', '/Bulk', {
            schemas: [ScimSchema.BULK_REQUEST],
            Operations: [
                { method: 'PATCH', path: '/Users/bulkId:q', bulkId: 'p', data: patchOp({ op: 'replace', path: 'title', value: 'x' }) },
                { method: 'PATCH', path: '/Users/bulkId:p', bulkId: 'q', data: patchOp({ op: 'replace', path: 'title', value: 'y' }) }
            ]
        });
        expect(unresolvable.body['Operations']).toEqual([expect.objectContaining({ status: '409' }), expect.objectContaining({ status: '409' })]);

        const tooMany: ScimAnswer = await scim('POST', '/Bulk', {
            schemas: [ScimSchema.BULK_REQUEST],
            Operations: Array.from({ length: MAX_BULK_OPERATIONS + 1 }, () => ({ method: 'DELETE', path: '/Users/x' }))
        });
        expect(tooMany.status).toBe(413);
        expect(tooMany.body).toMatchObject({ schemas: [ScimSchema.ERROR], status: '413' });
    });

    it('records what the identity provider changed', async () => {
        const kate: Record<string, unknown> = await provisionUser('kate@corp.test');
        await scim('PATCH', `/Users/${String(kate['id'])}`, patchOp({ op: 'replace', path: 'displayName', value: 'Kate' }));
        await scim('DELETE', `/Users/${String(kate['id'])}`);
        await scim('POST', '/Users', { userName: 'KATE2@corp.test' });
        await scim('POST', '/Users', { userName: 'kate2@corp.test' });

        const events: unknown[] = await auditEvents();

        expect(events).toContainEqual(expect.objectContaining({ action: AuditAction.SCIM_USER_CREATED, outcome: AuditOutcome.SUCCESS }));
        expect(events).toContainEqual(expect.objectContaining({ action: AuditAction.SCIM_USER_UPDATED, outcome: AuditOutcome.SUCCESS }));
        expect(events).toContainEqual(expect.objectContaining({ action: AuditAction.SCIM_USER_DELETED, outcome: AuditOutcome.SUCCESS }));
        expect(events).toContainEqual(expect.objectContaining({ action: AuditAction.SCIM_USER_CREATED, outcome: AuditOutcome.FAILURE }));
    });
});