import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Event } from './event.model';
import { type EventServiceInterface } from './event-service.interface';
import { FrameworkEventNames } from './framework-event-names.model';
import { MembershipEventData } from './membership-event-data.model';
import { RolesChangedEventData } from './roles-changed-event-data.model';
import { UserEventData } from './user-event-data.model';
import { TestTimeouts } from '../__testing__/constants';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { TestMembership } from '../__testing__/mocks/entities/test-membership.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../__testing__/test-server/membership-repository';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { DefaultTestServerRoleRepository } from '../__testing__/test-server/role-repository';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../__testing__/wait-until.function';
import { type UserServiceInterface } from '../auth/user/user-service.interface';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { type TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { UUIDUtilities } from '../utilities/uuid.utilities';

declare module './event-service.interface' {
    // eslint-disable-next-line jsdoc/require-jsdoc
    interface ZibriEventMap {
        'framework-events.user-left': UserEventData,
        'framework-events.user-paused': UserEventData,
        'framework-events.user-resumed': UserEventData,
        'framework-events.member-joined': MembershipEventData,
        'framework-events.member-left': MembershipEventData,
        'framework-events.roles-edited': RolesChangedEventData
    }
}

const names: FrameworkEventNames = {
    userDeleted: 'framework-events.user-left',
    userDeactivated: 'framework-events.user-paused',
    userReactivated: 'framework-events.user-resumed',
    membershipStarted: 'framework-events.member-joined',
    membershipEnded: 'framework-events.member-left',
    rolesChanged: 'framework-events.roles-edited'
};

/**
 * An event as a subscriber received it.
 */
type ReceivedEvent = {
    /**
     * Its type.
     */
    type: string,
    /**
     * What it carries.
     */
    data: object,
    /**
     * The tenant it was emitted in, null for none.
     */
    tenantId: string | null
};

let server: StartedTestServer | undefined;
let tenants: TenantServiceInterface;
const received: ReceivedEvent[] = [];

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.FRAMEWORK_EVENT_NAMES, useValue: names })
        ]
    });
    tenants = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    await inject<EventServiceInterface>(ZIBRI_DI_TOKENS.EVENT_SERVICE).subscribeAll(
        (event: Event<object>) => {
            received.push({ type: event.type, data: event.data, tenantId: event.tenantId ?? null });
        },
        { subscriberId: 'framework-events' }
    );
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

/**
 * Creates a user.
 * @param name - What sets their email apart.
 * @returns The user.
 */
async function createUser(name: string): Promise<JwtUser> {
    return await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${name}-${UUIDUtilities.generate()}@framework-events.test`, roles: [Roles.USER] });
}

/**
 * Makes a user a member of a tenant.
 * @param userId - The user.
 * @param tenantId - The tenant.
 * @returns The membership.
 */
async function addMember(userId: string, tenantId: string): Promise<TestMembership> {
    return await tenants.runAs(
        tenantId,
        async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId, roles: [MemberRoles.USER] })
    );
}

/**
 * Waits for the events of some types about some value, and a little longer for any that should not
 * come.
 * @param count - How many are expected.
 * @param about - What the events are about, such as the id of a user.
 * @returns The events received about it, oldest first.
 */
async function receivedAbout(count: number, about: string): Promise<ReceivedEvent[]> {
    const of: () => ReceivedEvent[] = () => received.filter(event => Object.values(event.data).includes(about));
    try {
        await waitUntil(() => of().length >= count, 2000);
    }
    catch {
        // not thrown when they do not all come, so that the comparison says which are missing
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    // by type, since each hook claims its event before it runs, in whichever order the claims land
    return of().sort((a, b) => a.type.localeCompare(b.type));
}

// 06 §Q4: a user deleted, a membership ended or a role changed told no application subscriber
describe('the writes of the framework, as the events an application names', () => {
    it('emits a user removed from the store, outside every tenant', async () => {
        const user: JwtUser = await createUser('deleted');
        const tenantId: string = UUIDUtilities.generate();

        await tenants.runAs(tenantId, async () => await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).deleteById(user.id));

        expect(await receivedAbout(1, user.id)).toEqual([
            { type: 'framework-events.user-left', data: { userId: user.id }, tenantId: null }
        ]);
    });

    it('emits a user deactivated and reactivated, once for each change and not for one that changes nothing', async () => {
        const user: JwtUser = await createUser('paused');
        const users: UserServiceInterface = inject(ZIBRI_DI_TOKENS.USER_SERVICE);

        await users.updateDeactivatedAt(user.id, new Date(), undefined);
        // already deactivated, so nothing changes
        await users.updateDeactivatedAt(user.id, new Date(), undefined);
        // eslint-disable-next-line unicorn/no-null
        await users.updateDeactivatedAt(user.id, null, undefined);

        expect((await receivedAbout(2, user.id)).map(event => event.type)).toEqual([
            'framework-events.user-paused',
            'framework-events.user-resumed'
        ]);
    });

    it('emits a membership starting and ending in its tenant, and not a change of its roles', async () => {
        const user: JwtUser = await createUser('member');
        const tenantId: string = UUIDUtilities.generate();
        const memberships: DefaultTestServerMembershipRepository = inject(DefaultTestServerMembershipRepository);

        const membership: TestMembership = await addMember(user.id, tenantId);
        await tenants.runAs(tenantId, async () => await memberships.updateById(membership.id, { roles: [MemberRoles.ADMIN] }));
        await tenants.runAs(tenantId, async () => await memberships.updateDeactivatedAt(user.id, new Date(), undefined));
        // eslint-disable-next-line unicorn/no-null
        await tenants.runAs(tenantId, async () => await memberships.updateDeactivatedAt(user.id, null, undefined));
        await tenants.runAs(tenantId, async () => await memberships.deleteById(membership.id));

        const data: MembershipEventData = { userId: user.id, tenantId };
        expect(await receivedAbout(4, user.id)).toEqual([
            { type: 'framework-events.member-joined', data, tenantId },
            { type: 'framework-events.member-joined', data, tenantId },
            { type: 'framework-events.member-left', data, tenantId },
            { type: 'framework-events.member-left', data, tenantId }
        ]);
    });

    it('emits the memberships a write to every membership a filter matches moves from one user to another', async () => {
        const from: JwtUser = await createUser('moved-from');
        const to: JwtUser = await createUser('moved-to');
        const tenantId: string = UUIDUtilities.generate();
        await addMember(from.id, tenantId);

        await inject(DefaultTestServerMembershipRepository).updateAll({ userId: from.id }, { userId: to.id }, { acrossTenants: true });

        expect((await receivedAbout(2, from.id)).map(event => event.type)).toEqual([
            'framework-events.member-joined',
            'framework-events.member-left'
        ]);
        expect((await receivedAbout(2, to.id)).map(event => event.type)).toEqual([
            'framework-events.member-joined'
        ]);
    });

    it('emits the roles every tenant shares and those of one tenant changing, each where they are held', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const roles: DefaultTestServerRoleRepository = inject(DefaultTestServerRoleRepository);

        await roles.create(
            // eslint-disable-next-line unicorn/no-null
            { name: `shared-${UUIDUtilities.generate()}`, level: 'tenant', permissions: [], tenantId: null },
            { acrossTenants: true }
        );
        await tenants.runAs(tenantId, async () => await roles.create({ name: `own-${UUIDUtilities.generate()}`, level: 'tenant', permissions: [], tenantId }));

        expect(await receivedAbout(1, tenantId)).toEqual([
            { type: 'framework-events.roles-edited', data: { tenantId }, tenantId }
        ]);
        expect(received).toContainEqual({ type: 'framework-events.roles-edited', data: { tenantId: null }, tenantId: null });
    });

    it('takes only a type of the event map whose payload what the write carries fits', () => {
        // @ts-expect-error -- a user's event carries no tenant, which this type's payload requires
        const misfit: FrameworkEventNames = { userDeleted: 'framework-events.member-left' };
        // @ts-expect-error -- a type no event map declares
        const undeclared: FrameworkEventNames = { rolesChanged: 'framework-events.nobody-declared-this' };

        expect([misfit, undeclared]).toHaveLength(2);
    });
});
