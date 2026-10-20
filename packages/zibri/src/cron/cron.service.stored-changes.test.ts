import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { CronExpression, CronExpressionString } from './cron-expression.utilities.ts';
import { CreateCronJobEntityData, CronJobEntity, CronJobState } from './cron-job-entity.model.ts';
import { CronJob, InitialCronConfig } from './cron-job.model.ts';
import { CronSyncCronJob } from './cron-sync.cron-job.ts';
import { CronService } from './cron.service.ts';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { defineProvider } from '../di/models/di-provider.model.ts';

/**
 * Once a year, so no tick of its own fires while the cases run.
 */
const YEARLY: CronExpressionString = CronExpression.fromString('0 0 0 1 1 *');

/**
 * Daily at 04:30, the schedule another instance moves the job to.
 */
const DAILY_AT_0430: CronExpressionString = CronExpression.fromString('0 30 4 * * *');

/**
 * A job that counts its ticks.
 */
class ProbeCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = { name: 'probe', cron: YEARLY, timezone: 'UTC' };

    ticks: number = 0;

    override onTick(): void {
        this.ticks++;
    }
}

// in memory, with the real cron service: another instance is played by writing the row it would
// write, which is all one instance ever learns of another
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, CronJobEntity]
});

describe('CronService, after another instance changed a job', () => {
    let server: StartedTestServer;
    let cronService: CronService;
    let rows: Repository<CronJobEntity, CreateCronJobEntityData>;
    let probe: ProbeCronJob;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            cronJobs: [ProbeCronJob],
            providers: [
                ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.CRON_SERVICE),
                defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
            ]
        });
        await server.start();
        cronService = inject(CronService);
        rows = inject(repositoryTokenFor(CronJobEntity));
        probe = inject(ProbeCronJob);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        // eslint-disable-next-line unicorn/no-null
        await rows.updateAll({ name: 'probe' }, { state: CronJobState.ACTIVE, previousState: null, cron: YEARLY });
        await cronService.applyStoredChanges();
        probe.ticks = 0;
    });

    /**
     * Writes the row of the probe as another instance would.
     * @param changes - What the other instance changed.
     */
    async function changeElsewhere(changes: Partial<CreateCronJobEntityData>): Promise<void> {
        await rows.updateAll({ name: 'probe' }, changes);
    }

    it('skips a tick, and stops, once another instance disabled the job', async () => {
        await changeElsewhere({ state: CronJobState.INACTIVE });

        await probe.runOnTick(new Date());

        expect(probe.ticks).toBe(0);
        expect(probe.state).toBe(CronJobState.INACTIVE);
    });

    it('skips a tick once a tick on another instance stopped the job on an error', async () => {
        await changeElsewhere({ state: CronJobState.STOPPED_ON_ERROR, previousState: CronJobState.ACTIVE });

        await probe.runOnTick(new Date());

        expect(probe.ticks).toBe(0);
        expect(probe.state).toBe(CronJobState.STOPPED_ON_ERROR);
    });

    it('runs only the ticks of the new schedule once another instance rescheduled the job', async () => {
        await changeElsewhere({ cron: DAILY_AT_0430 });

        await probe.runOnTick(new Date('2026-10-16T04:31:00Z'));
        expect(probe.ticks).toBe(0);

        await probe.runOnTick(new Date('2026-10-16T04:30:00Z'));
        expect(probe.ticks).toBe(1);
    });

    it('puts the job back on the schedule at the next sync once another instance enabled it', async () => {
        await probe.disable();
        await changeElsewhere({ state: CronJobState.ACTIVE });

        await cronService.applyStoredChanges();

        expect(probe.active).toBe(true);
    });

    it('moves the job to the new schedule at the next sync', async () => {
        await changeElsewhere({ cron: DAILY_AT_0430 });

        await cronService.applyStoredChanges();

        expect(probe.matches(new Date('2026-10-16T04:30:00Z'))).toBe(true);
        expect(probe.matches(new Date('2027-01-01T00:00:00Z'))).toBe(false);
    });

    it('syncs on every instance, beside the jobs of the application', () => {
        const sync: CronJob | undefined = cronService.cronJobs.find(j => j instanceof CronSyncCronJob);

        expect(sync).toBeDefined();
        expect(sync?.distributed).toBe(false);
    });

    it('refuses to update a job declared in code', async () => {
        expect((await rows.findOne({ where: { name: 'probe' } })).source).toBe('code');

        await expect(cronService.update('probe', { runOnInit: true })).rejects.toThrow('is declared in code');
    });
});