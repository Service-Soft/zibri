import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { type AuditServiceInterface } from './audit-service.interface';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { AuditAction, AuditOutcome } from '../logging/audit-event.model';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Newable } from '../types/newable.type';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * What storing the audit trail costs, as calls on the store.
 */

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

describe('what storing the audit trail costs', () => {
    it('stores a burst of events of many tenants in two writes', async () => {
        const auditService: AuditServiceInterface = inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE);
        const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        const tenantIds: string[] = Array.from({ length: 10 }, () => UUIDUtilities.generate());
        await auditService.flush();

        roundTrips.reset();
        // all at once, the way the requests of several tenants arrive together
        await Promise.all(tenantIds.map(async tenantId => await tenants.runAs(tenantId, async () => {
            for (let i: number = 0; i < 10; i++) {
                auditService.record({ action: AuditAction.ROLE_ASSIGNED, outcome: AuditOutcome.SUCCESS, subject: `user${i}`, role: 'admin' });
            }
            await Promise.resolve();
        })));
        await auditService.flush();

        // the first event starts a write at once, and the 99 arriving while it runs share the next
        // one, whichever tenants they belong to
        expect(roundTrips.trips.filter(t => t.statement.startsWith('AuditEntry.')).length).toBeLessThanOrEqual(2);
    });
});