import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { TestMembership } from '../../__testing__/mocks/entities/test-membership.entity';
import { TestRole } from '../../__testing__/mocks/entities/test-role.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { DefaultTestServerRoleRepository } from '../../__testing__/test-server/role-repository';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Repository } from '../repository/repository';

const roundTrips: RoundTripCounter = new RoundTripCounter();

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories,
    roundTrips
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

/**
 * Creates a user who is a member of some new tenants.
 * @param name - What sets the user's email apart.
 * @param tenants - How many tenants they are a member of.
 * @returns The user.
 */
async function createMember(name: string, tenants: number): Promise<JwtUser> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${name}@membership-reporting.test`, roles: [Roles.USER] });
    await Promise.all(Array.from({ length: tenants }, async () => {
        const tenantId: string = UUIDUtilities.generate();
        await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
            tenantId,
            async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [MemberRoles.USER] })
        );
    }));
    return user;
}

/**
 * Runs some work and collects the calls it made on the store.
 * @param work - The work.
 * @returns The calls, as `Entity.method`.
 */
async function resolveCallsOf(work: () => Promise<unknown>): Promise<string[]> {
    await roundTrips.resolveCountOf(work);
    return roundTrips.trips.map(t => t.statement);
}

// a write to every membership a filter matches read each of them back, for the sake of the
// users and tenants they belong to. What follows them is the websockets', whose suite reads them as pairs
describe('what a write to every membership a filter matches reads', () => {
    // the membership service read them for the websocket service, in an application with none
    it('moves memberships between users without reading them first, in an application without websockets', async () => {
        const from: JwtUser = await createMember('moved-from', 20);
        const to: JwtUser = await createMember('moved-to', 0);

        const calls: string[] = await resolveCallsOf(async () => await inject(DefaultTestServerMembershipRepository).updateAll(
            { userId: from.id },
            { userId: to.id },
            { acrossTenants: true }
        ));

        expect(calls).toEqual(['TestMembership.updateAll']);
    });

    it('removes a membership without reading it again first, in an application without websockets', async () => {
        const member: JwtUser = await createMember('removed', 1);
        const membership: TestMembership = await inject(DefaultTestServerMembershipRepository)
            .findOne({ where: { userId: member.id }, acrossTenants: true });

        const calls: string[] = await resolveCallsOf(async () => await inject(DefaultTestServerMembershipRepository)
            .deleteById(membership.id, { acrossTenants: true }));

        expect(calls).toEqual(['TestMembership.findOne', 'TestMembership.remove']);
    });

    it('checks the roles it writes against each tenant the memberships belong to, read as tenants rather than as rows', async () => {
        const member: JwtUser = await createMember('roles-written', 20);

        const calls: string[] = await resolveCallsOf(async () => await inject(DefaultTestServerMembershipRepository).updateAll(
            { userId: member.id },
            { roles: [MemberRoles.ADMIN] },
            { acrossTenants: true }
        ));

        // once, for the check and the report alike
        expect(calls).toEqual(['TestMembership.aggregate', 'TestMembership.updateAll']);
        await expect(inject(DefaultTestServerMembershipRepository).updateAll(
            { userId: member.id },
            { roles: ['no-such-role'] },
            { acrossTenants: true }
        )).rejects.toThrow(/no-such-role/);
    });
});

/**
 * Creates a role every tenant shares.
 * @param name - Its name.
 * @returns The role.
 */
async function createSharedRole(name: string): Promise<TestRole> {
    // eslint-disable-next-line unicorn/no-null
    return await inject(DefaultTestServerRoleRepository).create({ name, level: 'tenant', permissions: [], tenantId: null }, { acrossTenants: true });
}

// the check of a write to roles and the report of it each read the roles it changes
describe('what a write to roles reads before it writes', () => {
    it('reads the role an update changes once', async () => {
        const role: TestRole = await createSharedRole('updated-once');

        const calls: string[] = await resolveCallsOf(async () => await inject(DefaultTestServerRoleRepository)
            .updateById(role.id, { permissions: [] }, { acrossTenants: true }));

        expect(calls).toEqual([
            // whether it is there
            'TestRole.find',
            // as it is, for the check and for the tenants whose roles change: an update by id is an
            // update of every row a filter matches, read as what the observers need of them
            'TestRole.aggregate',
            'TestRole.updateAll',
            // the roles read again once they changed, and every other instance told
            'TestRole.find',
            'CacheInvalidation.insert',
            'publish zibri.wake-up'
        ]);
    });

    it('reads the role a delete removes once', async () => {
        const role: TestRole = await createSharedRole('deleted-once');

        const calls: string[] = await resolveCallsOf(async () => await inject(DefaultTestServerRoleRepository)
            .deleteById(role.id, { acrossTenants: true }));

        expect(calls).toEqual([
            // the row to delete
            'TestRole.findOne',
            // as it is, for whether anybody holds it and for the tenants whose roles change
            'TestRole.find',
            'JwtUser.count',
            'TestMembership.count',
            'TestRole.remove',
            'TestRole.find',
            'CacheInvalidation.insert',
            'publish zibri.wake-up'
        ]);
        await expect(inject(DefaultTestServerRoleRepository).findById(role.id, { acrossTenants: true })).rejects.toThrow();
    });
});