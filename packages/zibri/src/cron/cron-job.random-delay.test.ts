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

// every run started up to a second after its slot, at
// random, with no way to turn it off

/**
 * How many runs the case looks at. With the delay of up to a second, four that all start within
 * {@link ON_TIME_IN_MS} come up by chance about once in 250 runs of the case.
 */
const RUNS: number = 4;

/**
 * How late after its slot a run may start and still count as on time: what the election and the event
 * loop take.
 */
const ON_TIME_IN_MS: number = 250;

/**
 * A job every second, without the random delay, recording how far into its second each run started.
 */
class OnTheSlotCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'on-the-slot',
        cron: CronExpression.fromString('* * * * * *'),
        timezone: 'UTC',
        maxRandomDelayInMs: 0
    };

    /**
     * How many milliseconds after its slot each run started.
     */
    readonly delaysInMs: number[] = [];

    override onTick(): void {
        this.delaysInMs.push(Date.now() % Ms.SECOND);
    }
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, CronJobEntity],
    repositories: defaultTestServerRepositories
});

describe('A cron job without the random delay', () => {
    let server: StartedTestServer;
    let job: OnTheSlotCronJob;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            cronJobs: [OnTheSlotCronJob],
            providers: [
                ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.CRON_SERVICE),
                defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
            ]
        });
        await server.start();
        job = inject(OnTheSlotCronJob);
        while (job.delaysInMs.length < RUNS) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }, TestTimeouts.inMemory.start + (RUNS * Ms.SECOND));

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('starts every run on its slot', () => {
        expect(job.delaysInMs.slice(0, RUNS).every(delay => delay < ON_TIME_IN_MS)).toBe(true);
    });
});