import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { CronExpression, CronExpressionString } from './cron-expression.utilities';
import { CronJobEntity } from './cron-job-entity.model';
import { CronJob, InitialCronConfig } from './cron-job.model';
import { CronService } from './cron.service';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { LoggerInterface } from '../logging/logger.interface';
import { Ms } from '../utilities/ms';

/**
 * Every five seconds, so a slot comes up while the case runs and the next one is far enough away to
 * tell them apart.
 */
const EVERY_FIVE_SECONDS: CronExpressionString = CronExpression.fromString('*/5 * * * * *');

/**
 * How long past a slot the case blocks the event loop.
 */
const BLOCKED_PAST_THE_SLOT_IN_MS: number = 2 * Ms.SECOND;

/**
 * A job that counts its ticks.
 */
abstract class CountingCronJob extends CronJob {
    /**
     * How many ticks ran.
     */
    ticks: number = 0;

    override onTick(): void {
        this.ticks++;
    }
}

class CatchingUpCronJob extends CountingCronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'late-catching-up',
        cron: EVERY_FIVE_SECONDS,
        timezone: 'UTC',
        catchUpWithinMs: 4 * Ms.SECOND
    };
}

class NotCatchingUpCronJob extends CountingCronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'late-not-catching-up',
        cron: EVERY_FIVE_SECONDS,
        timezone: 'UTC'
    };
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, CronJobEntity]
});

describe('A cron job reaching a slot late inside a running process', () => {
    let server: StartedTestServer;
    let catchingUp: CatchingUpCronJob;
    let notCatchingUp: NotCatchingUpCronJob;
    let warn: jest.SpiedFunction<LoggerInterface['warn']>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            cronJobs: [CatchingUpCronJob, NotCatchingUpCronJob],
            providers: [
                ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.CRON_SERVICE),
                defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
            ]
        });
        await server.start();
        catchingUp = inject(CatchingUpCronJob);
        notCatchingUp = inject(NotCatchingUpCronJob);
        warn = jest.spyOn(inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER), 'warn');

        // half a second before a slot, then blocked until well past it, the way a long synchronous
        // computation would block it
        const slot: number = catchingUp['task']?.getNextRun()?.getTime() ?? 0;
        await new Promise(resolve => setTimeout(resolve, slot - Date.now() - 500));
        catchingUp.ticks = 0;
        notCatchingUp.ticks = 0;
        while (Date.now() < slot + BLOCKED_PAST_THE_SLOT_IN_MS) {
            // blocking on purpose
        }
        // the jitter before a tick starts is at most a second, and the next slot is three away
        await new Promise(resolve => setTimeout(resolve, 1500));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('runs the slot while it is no later than catchUpWithinMs', () => {
        expect(catchingUp.ticks).toBe(1);
    });

    it('leaves the slot out without catchUpWithinMs, and warns through the app logger naming the job', () => {
        expect(notCatchingUp.ticks).toBe(0);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('late-not-catching-up'));
    });
});