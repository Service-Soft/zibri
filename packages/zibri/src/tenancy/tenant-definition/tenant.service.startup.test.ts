import { describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { TestTenant } from '../../__testing__/mocks/entities/test-tenant.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { BaseTenantEntity } from '../../entity/base-tenant-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Logger } from '../../logging/logger';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { type TenantServiceInterface } from '../tenant-service.interface';
import { BaseTenantDefinitionEntity } from './base-tenant-definition.model';

// a file of its own, for the reason the start of the MembershipService gives

/**
 * The tenants, by mistake as rows that each belong to a tenant.
 */
@Entity({ allowOrphan: true })
class Tenant extends BaseTenantEntity() {}

/**
 * Tenants that cannot be deactivated.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class PermanentTenant extends BaseTenantDefinitionEntity() {}

/**
 * Tenants whose rows belong to a tenant themselves.
 */
@Entity({ allowOrphan: true })
class NestedTenant extends BaseTenantDefinitionEntity({ deactivatable: true }) {
    @Property.string({ format: 'uuid' })
    tenantId!: string;
}

/**
 * Starts an application with the given entities beside the defaults of the test server, and stops it after the work.
 * @param entities - The entities.
 * @param work - What to do while it runs.
 */
async function withServer(entities: Newable<BaseEntity>[], work: () => Promise<void>): Promise<void> {
    const server: StartedTestServer = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, ...entities], repositories: defaultTestServerRepositories, allowOrphan: true })]
    });
    try {
        await work();
    }
    finally {
        await server.shutdown();
    }
}

function tenants(): TenantServiceInterface {
    return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
}

describe('TenantService - starting', () => {
    it('leaves an application without an entity of the tenants as it is', async () => {
        await withServer([], async () => {
            expect(await tenants().resolveIsDeactivated?.(UUIDUtilities.generate())).toBe(false);
            await expect(tenants().validateNotDeactivated?.(UUIDUtilities.generate())).resolves.toBeUndefined();
            await expect(tenants().deactivateTenant?.(UUIDUtilities.generate())).rejects.toThrow(/No entity of the tenants is declared/);
        });
    }, TestTimeouts.inMemory.start);

    it('warns about an entity of the tenants that extends BaseTenantEntity()', async () => {
        const warn: jest.SpiedFunction<Logger['warn']> = jest.spyOn(Logger.prototype, 'warn');
        try {
            await withServer([Tenant], () => Promise.resolve());

            expect(warn.mock.calls.map(([message]) => message)).toContainEqual(expect.stringMatching(/Tenant extends BaseTenantEntity\(\)[\S\s]*BaseTenantDefinitionEntity\(\)/));
        }
        finally {
            warn.mockRestore();
        }
    }, TestTimeouts.inMemory.start);

    it('refuses deactivating tenants that cannot be deactivated, and deleting them without TenantDeletion', async () => {
        await withServer([PermanentTenant], async () => {
            await expect(tenants().deactivateTenant?.(UUIDUtilities.generate())).rejects.toThrow(/cannot be deactivated/);
            expect(await tenants().resolveIsDeactivated?.(UUIDUtilities.generate())).toBe(false);
        });
        await withServer([TestTenant], async () => {
            await expect(tenants().deleteTenant?.(UUIDUtilities.generate())).rejects.toThrow(/needs TenantDeletion/);
        });
    }, TestTimeouts.inMemory.start * 2);

    it('refuses an entity of the tenants whose rows belong to a tenant, and two of them', async () => {
        await expect(withServer([NestedTenant], () => Promise.resolve())).rejects.toThrow(/@Entity\({ tenant: 'shared' }\)/);
        await expect(withServer([TestTenant, PermanentTenant], () => Promise.resolve())).rejects.toThrow(/Several entities are entities of the tenants/);
    }, TestTimeouts.inMemory.start * 2);
});