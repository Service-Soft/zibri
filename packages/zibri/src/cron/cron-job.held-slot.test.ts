import { setTimeout } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { CronExpression } from './cron-expression.utilities';
import { CronJobEntity } from './cron-job-entity.model';
import { CronJob, InitialCronConfig } from './cron-job.model';
import { CronService } from './cron.service';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { Ms } from '../utilities/ms';

/**
 * Shorter than the run, so a claim that was not renewed would have lapsed while the run is still going.
 */
const EXECUTION_LEASE_IN_MS: number = 500;

/**
 * How long one run of the job takes.
 */
const RUN_IN_MS: number = 1500;

/**
 * A nightly job whose run outlasts the execution lease, and which catches up a slot it missed.
 */
class SlowNightlyCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'slow-nightly',
        cron: CronExpression.daily().at(3, 'hours')
            .build(),
        timezone: 'UTC',
        catchUpWithinInMs: Ms.DAY
    };

    /**
     * How many runs started.
     */
    runs: number = 0;

    async onTick(): Promise<void> {
        this.runs++;
        await setTimeout(RUN_IN_MS);
    }
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, CronJobEntity],
    repositories: defaultTestServerRepositories
});

describe('A cron job whose run outlasts the execution lease', () => {
    let server: StartedTestServer;
    let job: SlowNightlyCronJob;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            cronJobs: [SlowNightlyCronJob],
            providers: [
                ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.CRON_SERVICE),
                defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService }),
                defineProvider({ token: ZIBRI_DI_TOKENS.CRON_EXECUTION_LEASE_IN_MS, useValue: EXECUTION_LEASE_IN_MS })
            ]
        });
        await server.start();
        job = inject(SlowNightlyCronJob);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('holds the slot for as long as the run lasts, so a second claim of the slot during the run does not run it again', async () => {
        // the slot of last night, which an instance booting during the run would find missed and
        // claim with the same key the run holds
        const slot: Date = new Date(Date.now() - Ms.HOUR);
        const running: Promise<void> = job.runOnTick(slot);
        await setTimeout(EXECUTION_LEASE_IN_MS * 2);
        expect(job.runs).toBe(1);

        await job.runOnTick(slot);

        expect(job.runs).toBe(1);
        await running;
        expect(job.runs).toBe(1);
        // the slot is dealt with: the row says when it ran, so nothing is left to catch up
        expect(job.lastRun?.getTime()).toBeGreaterThanOrEqual(slot.getTime());
    });

    it('keeps the slot claimed once the run is over, until the lease lapses', async () => {
        const slot: Date = new Date(Date.now() - (Ms.HOUR * 2));
        await job.runOnTick(slot);
        expect(job.runs).toBe(2);

        await job.runOnTick(slot);
        expect(job.runs).toBe(2);

        await setTimeout(EXECUTION_LEASE_IN_MS * 2);
        // lapsed: an execution whose instance died is taken over, which is what the lease is for
        await job.runOnTick(slot);
        expect(job.runs).toBe(3);
    });
});