import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { MembershipServiceInterface } from './membership-service.interface';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { TestMembership } from '../../__testing__/mocks/entities/test-membership.entity';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { TenantServiceInterface } from '../tenant-service.interface';

let server: StartedTestServer | undefined;

/**
 * The users of the running application.
 * @returns Their repository.
 */
function users(): Repository<JwtUser> {
    return inject(repositoryTokenFor(JwtUser));
}

/**
 * The membership service of the running application.
 * @returns The service.
 */
function memberships(): MembershipServiceInterface {
    return inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE);
}

/**
 * Makes a user a member of a new tenant.
 * @param user - The user.
 * @returns The id of the tenant.
 */
async function joinNewTenant(user: JwtUser): Promise<string> {
    const tenantId: string = UUIDUtilities.generate();
    await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
        tenantId,
        async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [Roles.USER] })
    );
    return tenantId;
}

/**
 * Creates a user who is a member of two tenants.
 * @param name - What sets the user's email apart.
 * @returns The user.
 */
async function createMemberOfTwoTenants(name: string): Promise<JwtUser> {
    const user: JwtUser = await users().create({ email: `${name}@memberships.test`, roles: [Roles.USER] });
    await joinNewTenant(user);
    await joinNewTenant(user);
    return user;
}

describe('MembershipService', () => {
    beforeAll(async () => {
        server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })] });
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    beforeEach(async () => {
        await inject<Repository<TestMembership>>(repositoryTokenFor(TestMembership)).deleteAll({}, { acrossTenants: true });
        await users().deleteAll({});
    });

    it('finds the membership of a user in one tenant, and their memberships in every tenant', async () => {
        const user: JwtUser = await users().create({ email: 'finds@memberships.test', roles: [Roles.USER] });
        const first: string = await joinNewTenant(user);
        const second: string = await joinNewTenant(user);

        expect((await memberships().findMembership(user.id, first))?.tenantId).toBe(first);
        expect(await memberships().findMembership(user.id, UUIDUtilities.generate())).toBeUndefined();
        expect((await memberships().findMemberships(user.id)).map(m => m.tenantId)).toEqual(expect.arrayContaining([first, second]));
        expect(await memberships().findMemberships(user.id)).toHaveLength(2);
    });

    it('answers the membership a user has in a tenant, creating one without roles when they have none', async () => {
        const user: JwtUser = await users().create({ email: 'resolves@memberships.test', roles: [Roles.USER] });
        const tenantId: string = UUIDUtilities.generate();

        const created: TestMembership = await memberships().resolveMembership(user.id, tenantId, undefined);
        const again: TestMembership = await memberships().resolveMembership(user.id, tenantId, undefined);

        expect(created).toMatchObject({ tenantId, userId: user.id, roles: [] });
        expect(again.id).toBe(created.id);
    });

    it('finds no membership while it is deactivated, and deletes one in its tenant only', async () => {
        const user: JwtUser = await users().create({ email: 'deactivates@memberships.test', roles: [Roles.USER] });
        const first: string = await joinNewTenant(user);
        const second: string = await joinNewTenant(user);

        await memberships().updateDeactivatedAt(user.id, first, new Date(), undefined);

        expect(await memberships().findMembership(user.id, first)).toBeUndefined();
        expect((await memberships().findMemberships(user.id)).map(m => m.tenantId)).toEqual([second]);
        // still stored, with its roles, rather than made anew
        expect((await memberships().resolveMembership<Roles, TestMembership>(user.id, first, undefined)).roles).toEqual([Roles.USER]);

        await memberships().deleteMembership(user.id, second, undefined);
        expect(await memberships().findMemberships(user.id)).toEqual([]);

        // null rather than undefined: it clears the column
        // eslint-disable-next-line unicorn/no-null
        await memberships().updateDeactivatedAt(user.id, first, null, undefined);
        expect((await memberships().findMembership(user.id, first))?.roles).toEqual([Roles.USER]);
    });

    it('deletes the memberships of a user in every tenant with the user, whichever way the user is deleted', async () => {
        const byId: JwtUser = await createMemberOfTwoTenants('by-id');
        const byFilter: JwtUser = await createMemberOfTwoTenants('by-filter');
        const kept: JwtUser = await createMemberOfTwoTenants('kept');

        await users().deleteById(byId.id);
        await users().deleteAll({ id: byFilter.id });

        expect(await memberships().findMemberships(byId.id)).toEqual([]);
        expect(await memberships().findMemberships(byFilter.id)).toEqual([]);
        // the memberships of everybody else stay
        expect(await memberships().findMemberships(kept.id)).toHaveLength(2);
    });

    it('deletes the memberships in the transaction that deletes the user, so they stay when it rolls back', async () => {
        const user: JwtUser = await createMemberOfTwoTenants('rolled-back');

        const transaction: Transaction = await users().dataSource.startTransaction();
        await users().deleteById(user.id, { transaction });
        await transaction.rollback();

        expect(await users().findById(user.id)).toMatchObject({ id: user.id });
        expect(await memberships().findMemberships(user.id)).toHaveLength(2);
    });
});