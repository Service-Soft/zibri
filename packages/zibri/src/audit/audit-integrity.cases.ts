import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { AuditCheckpoint, AuditCheckpointCreateData } from './audit-checkpoint.model';
import { AuditEntry, AuditEntryCreateData } from './audit-entry.model';
import { type AuditServiceInterface } from './audit-service.interface';
import { runWithApplicationClockAhead } from '../__testing__/run-with-application-clock-ahead.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { RepositoryDriverInterface } from '../data-source/driver/repository-driver.interface';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { AuditAction, AuditOutcome } from '../logging/audit-event.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { Newable } from '../types/newable.type';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * The cases every data source answers the same way about an audit trail kept with checkpoints. A file
 * per data source runs them against a server of its own.
 */

/**
 * How far ahead of the real time the cases so far moved the clock.
 *
 * Each case records after everything the cases before it sealed, since a span is sealed once: an entry
 * stored into a span already sealed is one the checkpoint does not hold.
 */
let hoursAhead: number = 0;

/**
 * Takes the next hours of the clock for a case, enough for two spans to be recorded and sealed in.
 * @returns How far ahead of the real time the case starts, in milliseconds.
 */
function takeHours(): number {
    hoursAhead += 5;
    return hoursAhead * Ms.HOUR;
}

/**
 * Runs every case against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param dataSources - The data sources of the server, the one holding the trail among them.
 * @param startTimeoutInMs - How long the server may take to start.
 * @param shutdownTimeoutInMs - How long it may take to shut down.
 */
export function describeAuditIntegrity(
    dataSourceName: string,
    dataSources: Newable<DataSourceInterface>[],
    startTimeoutInMs: number,
    shutdownTimeoutInMs: number
): void {
    describe(`an audit trail kept with checkpoints, on ${dataSourceName}`, () => {
        let server: StartedTestServer | undefined;
        let auditService: AuditServiceInterface;

        beforeAll(async () => {
            server = await startTestServer({ dataSources });
            auditService = inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE);
        }, startTimeoutInMs);

        afterAll(async () => {
            await server?.shutdown();
        }, shutdownTimeoutInMs);

        /**
         * The repository of the entries.
         * @returns The repository.
         */
        function entries(): Repository<AuditEntry, AuditEntryCreateData> {
            return inject(repositoryTokenFor(AuditEntry));
        }

        /**
         * The repository of the checkpoints.
         * @returns The repository.
         */
        function checkpoints(): Repository<AuditCheckpoint, AuditCheckpointCreateData> {
            return inject(repositoryTokenFor(AuditCheckpoint));
        }

        /**
         * What writes the entries past the repository, the way someone with access to the data source does.
         * @returns The driver.
         */
        function entryStore(): RepositoryDriverInterface<AuditEntry> {
            return entries()['driver'];
        }

        /**
         * Records events of a tenant at a time, and waits until they are stored.
         * @param aheadInMs - When, as how far ahead of the real time.
         * @param tenantId - The tenant.
         * @param subjects - The subject of each event.
         */
        async function recordAt(aheadInMs: number, tenantId: string, ...subjects: string[]): Promise<void> {
            await runWithApplicationClockAhead(aheadInMs, async () => {
                await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => {
                    for (const subject of subjects) {
                        auditService.record({
                            action: AuditAction.ROLE_ASSIGNED,
                            outcome: AuditOutcome.SUCCESS,
                            subject,
                            role: 'admin',
                            scopes: ['tasks']
                        });
                    }
                    await Promise.resolve();
                });
                await auditService.flush();
            });
        }

        /**
         * Seals what is stored, at a time.
         * @param aheadInMs - When, as how far ahead of the real time.
         * @returns How many checkpoints were written.
         */
        async function sealAt(aheadInMs: number): Promise<number> {
            return await runWithApplicationClockAhead(aheadInMs, async () => await auditService.writeCheckpoints());
        }

        /**
         * The entries of a tenant, in the order they were stored.
         * @param tenantId - The tenant.
         * @returns The entries.
         */
        async function entriesOf(tenantId: string): Promise<AuditEntry[]> {
            return await entries().findAll({ where: { tenantId }, order: { recordedAt: 'ASC', subject: 'ASC' }, acrossTenants: true });
        }

        /**
         * The checkpoints of a tenant, in the order of their chain.
         * @param tenantId - The tenant.
         * @returns The checkpoints.
         */
        async function checkpointsOf(tenantId: string): Promise<AuditCheckpoint[]> {
            return await checkpoints().findAll({ where: { tenantId }, order: { chainSequence: 'ASC' }, acrossTenants: true });
        }

        it('seals the entries of each tenant in a checkpoint of its own once their hour ended, and the trail of each holds', async () => {
            const ahead: number = takeHours();
            const team: string = UUIDUtilities.generate();
            const other: string = UUIDUtilities.generate();
            await recordAt(ahead, team, 'ada', 'grace', 'alan');
            await recordAt(ahead, other, 'edsger');

            await sealAt(ahead + (Ms.HOUR * 2));

            const [sealed] = await checkpointsOf(team);
            expect([sealed?.entryCount, (await checkpointsOf(other)).map(c => c.entryCount)]).toEqual([3, [1]]);
            expect(await auditService.resolveVerification(team)).toEqual({
                intact: true,
                newestSequence: 1,
                newestHash: sealed?.chainHash,
                sealedUntil: sealed?.periodEnd
            });
            expect(await auditService.resolveVerification(other)).toMatchObject({ intact: true, newestSequence: 1 });
        });

        it('seals a span once, however often it is asked to', async () => {
            const ahead: number = takeHours();
            const team: string = UUIDUtilities.generate();
            await recordAt(ahead, team, 'ada');

            await sealAt(ahead + (Ms.HOUR * 2));
            await sealAt(ahead + (Ms.HOUR * 2));

            expect((await checkpointsOf(team)).map(c => c.entryCount)).toEqual([1]);
        });

        // 12 §O3: a checkpoint sealed whole hours only, so running the job more often sealed nothing sooner
        it('seals what was stored up to five minutes before it runs, however soon after the checkpoint before', async () => {
            const ahead: number = takeHours();
            const team: string = UUIDUtilities.generate();
            await recordAt(ahead, team, 'ada');
            await sealAt(ahead + (Ms.MINUTE * 6));
            await recordAt(ahead + (Ms.MINUTE * 7), team, 'grace');
            await recordAt(ahead + (Ms.MINUTE * 12), team, 'alan');

            await sealAt(ahead + (Ms.MINUTE * 13));

            const [first, second] = await checkpointsOf(team);
            expect([first?.entryCount, second?.entryCount, second?.periodStart]).toEqual([1, 1, first?.periodEnd]);
            expect(await auditService.resolveVerification(team)).toMatchObject({ intact: true, newestSequence: 2 });
        });

        it('goes on where the checkpoint before it ends, and the trail still holds', async () => {
            const ahead: number = takeHours();
            const team: string = UUIDUtilities.generate();
            await recordAt(ahead, team, 'ada');
            await sealAt(ahead + (Ms.HOUR * 2));
            await recordAt(ahead + (Ms.HOUR * 2), team, 'grace', 'alan');

            await sealAt(ahead + (Ms.HOUR * 4));

            const [first, second] = await checkpointsOf(team);
            expect([second?.periodStart, second?.entryCount]).toEqual([first?.periodEnd, 2]);
            expect(await auditService.resolveVerification(team))
                .toMatchObject({ intact: true, newestSequence: 2, sealedUntil: second?.periodEnd });
        });

        it('logs where each checkpoint leaves the chain of its tenant, for a copy outside the data source', async () => {
            const ahead: number = takeHours();
            const team: string = UUIDUtilities.generate();
            await recordAt(ahead, team, 'ada');
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            const info: jest.Spied<LoggerInterface['info']> = jest.spyOn(logger, 'info');
            let logged: unknown[] = [];

            try {
                await sealAt(ahead + (Ms.HOUR * 2));
                logged = info.mock.calls.map(([, options]) => options?.metadata?.['auditCheckpoint']);
            }
            finally {
                info.mockRestore();
            }

            const [sealed] = await checkpointsOf(team);
            expect(logged).toContainEqual({
                tenantId: team,
                chainSequence: 1,
                chainHash: sealed?.chainHash
            });
        });

        it('tells an entry that was changed past the repository, sealed or not', async () => {
            const ahead: number = takeHours();
            const team: string = UUIDUtilities.generate();
            await recordAt(ahead, team, 'ada', 'grace');
            await sealAt(ahead + (Ms.HOUR * 2));
            await recordAt(ahead + (Ms.HOUR * 2), team, 'alan');
            const [sealed, , unsealed] = await entriesOf(team);

            await entryStore().updateAll({ where: { id: unsealed?.id }, data: { role: 'owner' } });
            expect(await auditService.resolveVerification(team))
                .toEqual({ intact: false, reason: `The entry ${unsealed?.id} is not as it was recorded.` });

            await entryStore().updateAll({ where: { id: sealed?.id }, data: { subject: 'mallory' } });
            expect(await auditService.resolveVerification(team))
                .toEqual({ intact: false, reason: `The entry ${sealed?.id} is not as it was recorded.` });
        });

        it('tells an entry that was removed from a sealed hour past the repository', async () => {
            const ahead: number = takeHours();
            const team: string = UUIDUtilities.generate();
            await recordAt(ahead, team, 'ada', 'grace');
            await sealAt(ahead + (Ms.HOUR * 2));
            const [removed] = await entriesOf(team);

            await entryStore().remove([String(removed?.id)], undefined, undefined);

            expect(await auditService.resolveVerification(team))
                .toMatchObject({ intact: false, reason: expect.stringContaining('are not the 2 the checkpoint at 1 sealed') });
        });

        it('tells a copy of an entry that was slipped into a sealed hour past the repository', async () => {
            const ahead: number = takeHours();
            const team: string = UUIDUtilities.generate();
            await recordAt(ahead, team, 'ada');
            await sealAt(ahead + (Ms.HOUR * 2));
            const [copied] = await entriesOf(team);

            // its hash is the one of the entry it copies, which only the count of the hour tells apart
            await entryStore().insert([{ ...copied, id: UUIDUtilities.generate() }], undefined);

            expect(await auditService.resolveVerification(team))
                .toMatchObject({ intact: false, reason: expect.stringContaining('are not the 1 the checkpoint at 1 sealed') });
        });

        it('tells a checkpoint that was removed past the repository, with the entries it sealed', async () => {
            const ahead: number = takeHours();
            const team: string = UUIDUtilities.generate();
            await recordAt(ahead, team, 'ada');
            await sealAt(ahead + (Ms.HOUR * 2));
            await recordAt(ahead + (Ms.HOUR * 2), team, 'grace');
            await sealAt(ahead + (Ms.HOUR * 4));
            const [first] = await checkpointsOf(team);
            const [sealedByFirst] = await entriesOf(team);

            await entryStore().remove([String(sealedByFirst?.id)], undefined, undefined);
            await checkpoints()['driver'].remove([String(first?.id)], undefined, undefined);

            expect(await auditService.resolveVerification(team))
                .toEqual({ intact: false, reason: 'The checkpoint at 2: The rows from 1 to 1 are missing.' });
        });

        it('refuses to change or delete an entry through the repository', async () => {
            const ahead: number = takeHours();
            const team: string = UUIDUtilities.generate();
            await recordAt(ahead, team, 'ada');
            const [entry] = await entriesOf(team);

            await expect(entries().updateById(String(entry?.id), { subject: 'mallory' }, { acrossTenants: true }))
                .rejects.toThrow('are append only, and are only created');
            await expect(entries().deleteAll({ tenantId: team }, { acrossTenants: true }))
                .rejects.toThrow('are append only, and are only created');
        });
    });
}