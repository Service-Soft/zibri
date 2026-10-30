import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { type AuditServiceInterface } from './audit-service.interface';
import { ChainedAuditEntry, ChainedAuditEntryCreateData } from './chained-audit-entry.model';
import { TestTimeouts } from '../__testing__/constants';
import { runWithApplicationClockAhead } from '../__testing__/run-with-application-clock-ahead.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { AuditAction, AuditOutcome } from '../logging/audit-event.model';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';

const RETENTION_IN_MS: number = Ms.DAY * 30;

let server: StartedTestServer | undefined;
let auditService: AuditServiceInterface;
let entries: Repository<ChainedAuditEntry, ChainedAuditEntryCreateData>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, ChainedAuditEntry], repositories: defaultTestServerRepositories })],
        providers: [
            ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS),
            defineProvider({ token: ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS, useValue: RETENTION_IN_MS }),
            defineProvider({ token: ZIBRI_DI_TOKENS.AUDIT_INTEGRITY, useValue: 'chain' })
        ]
    });
    auditService = inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE);
    entries = inject(repositoryTokenFor(ChainedAuditEntry));
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

/**
 * Records events of a tenant, and waits until they are stored.
 * @param tenantId - The tenant.
 * @param subjects - The subject of each event.
 */
async function record(tenantId: string, ...subjects: string[]): Promise<void> {
    const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    await tenants.runAs(tenantId, async () => {
        for (const subject of subjects) {
            auditService.record({ action: AuditAction.LOGOUT, outcome: AuditOutcome.SUCCESS, subject });
        }
        await Promise.resolve();
    });
    await auditService.flush();
}

/**
 * The entries of a tenant, in the order of their chain.
 * @param tenantId - The tenant.
 * @returns The entries.
 */
async function chainOf(tenantId: string): Promise<ChainedAuditEntry[]> {
    return await entries.findAll({ where: { tenantId }, order: { chainSequence: 'ASC' }, acrossTenants: true });
}

// evaluation/round-2/06-infrastructure F26: the trail kept as a chain, for an application choosing it
describe('an audit trail kept as a chain', () => {
    it('chains the entries of each tenant, and writes no checkpoints', async () => {
        const team: string = UUIDUtilities.generate();

        await record(team, 'ada', 'grace');

        const chain: ChainedAuditEntry[] = await chainOf(team);
        expect(chain.map(e => [e.chainSequence, e.subject])).toEqual([[1, 'ada'], [2, 'grace']]);
        expect(await auditService.writeCheckpoints()).toBe(0);
        expect(await auditService.resolveVerification(team))
            .toEqual({ intact: true, newestSequence: 2, newestHash: chain.at(-1)?.chainHash, sealedUntil: undefined });
    });

    it('tells an entry that was removed past the repository at once', async () => {
        const team: string = UUIDUtilities.generate();
        await record(team, 'ada', 'grace', 'alan');
        const [, removed] = await chainOf(team);

        await entries['driver'].remove([String(removed?.id)], undefined, undefined);

        expect(await auditService.resolveVerification(team)).toEqual({ intact: false, reason: 'The entry at 3: The rows from 2 to 2 are missing.' });
    });

    it('deletes the entries older than the retention from the start of each chain, which still holds', async () => {
        const team: string = UUIDUtilities.generate();
        await runWithApplicationClockAhead(-RETENTION_IN_MS - Ms.HOUR, async () => await record(team, 'expired'));
        await record(team, 'kept');

        expect(await auditService.deleteExpiredEntries()).toBe(1);

        expect((await chainOf(team)).map(e => e.subject)).toEqual(['kept']);
        expect(await auditService.resolveVerification(team)).toMatchObject({ intact: true, newestSequence: 2 });
    });
});