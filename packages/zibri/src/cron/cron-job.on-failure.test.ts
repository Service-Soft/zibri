import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { CronExpression, CronExpressionString } from './cron-expression.utilities';
import { CreateCronJobEntityData, CronJobEntity, CronJobState } from './cron-job-entity.model';
import { CronJob, InitialCronConfig } from './cron-job.model';
import { CronService } from './cron.service';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { Ms } from '../utilities/ms';

/**
 * Once a year, so no tick of its own fires while the cases run.
 */
const YEARLY: CronExpressionString = CronExpression.fromString('0 0 0 1 1 *');

/**
 * Daily at 03:00, for counting the slots a job backs off over. Not due while the cases run either,
 * except in the minute before 03:00 UTC.
 */
const DAILY_AT_0300: CronExpressionString = CronExpression.fromString('0 0 3 * * *');

/**
 * A job whose next ticks throw as often as it is told.
 */
abstract class ScriptedCronJob extends CronJob {
    /**
     * How many of the next ticks throw.
     */
    failuresAhead: number = 0;

    /**
     * How many ticks ran, retries included.
     */
    ticks: number = 0;

    override onTick(): void {
        this.ticks++;
        if (this.failuresAhead > 0) {
            this.failuresAhead--;
            throw new Error('a scripted failure');
        }
    }
}

class RetryingCronJob extends ScriptedCronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'retrying',
        cron: YEARLY,
        timezone: 'UTC',
        onFailure: { retry: { attempts: 2, delayInMs: 10 } }
    };
}

class RetryingPastTheNextSlotCronJob extends ScriptedCronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'retrying-past-the-next-slot',
        cron: YEARLY,
        timezone: 'UTC',
        // longer than a year, so the first retry would already start after the next slot
        onFailure: { retry: { attempts: 3, delayInMs: 400 * Ms.DAY } }
    };
}

class StoppingCronJob extends ScriptedCronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'stopping',
        cron: YEARLY,
        timezone: 'UTC',
        onFailure: { stopAfterFailures: 3, restartAfterMs: Ms.HOUR }
    };
}

class BackingOffCronJob extends ScriptedCronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'backing-off',
        cron: DAILY_AT_0300,
        timezone: 'UTC',
        onFailure: { backOff: { maxSkippedSlots: 2 } }
    };
}

class LocalStoppingCronJob extends ScriptedCronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'local-stopping',
        cron: YEARLY,
        timezone: 'UTC',
        syncToDataSource: false,
        onFailure: { stopAfterFailures: 1, restartAfterMs: Ms.HOUR }
    };
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, CronJobEntity]
});

describe('A cron job whose ticks throw', () => {
    let server: StartedTestServer;
    let cronService: CronService;
    let rows: Repository<CronJobEntity, CreateCronJobEntityData>;
    let retrying: RetryingCronJob;
    let retryingPastTheNextSlot: RetryingPastTheNextSlotCronJob;
    let stopping: StoppingCronJob;
    let backingOff: BackingOffCronJob;
    let localStopping: LocalStoppingCronJob;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            cronJobs: [RetryingCronJob, RetryingPastTheNextSlotCronJob, StoppingCronJob, BackingOffCronJob, LocalStoppingCronJob],
            providers: [
                ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.CRON_SERVICE),
                defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
            ]
        });
        await server.start();
        cronService = inject(CronService);
        rows = inject(repositoryTokenFor(CronJobEntity));
        retrying = inject(RetryingCronJob);
        retryingPastTheNextSlot = inject(RetryingPastTheNextSlotCronJob);
        stopping = inject(StoppingCronJob);
        backingOff = inject(BackingOffCronJob);
        localStopping = inject(LocalStoppingCronJob);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        // eslint-disable-next-line unicorn/no-null
        await rows.updateAll({}, { state: CronJobState.ACTIVE, previousState: null, consecutiveFailures: 0, backedOffUntil: null });
        await cronService.applyStoredChanges();
        // the one job without a row is reset where it keeps its state
        const local: CronJobEntity | undefined = localStopping['entity'];
        if (local) {
            local.state = CronJobState.ACTIVE;
            // eslint-disable-next-line unicorn/no-null
            local.previousState = null;
        }
        for (const job of [retrying, retryingPastTheNextSlot, stopping, backingOff, localStopping]) {
            job.failuresAhead = 0;
            job.ticks = 0;
            // also in memory, so a case reading only what this instance holds is not passed by what
            // the case before left there
            const entity: CronJobEntity | undefined = job['entity'];
            if (entity) {
                entity.consecutiveFailures = 0;
                // eslint-disable-next-line unicorn/no-null
                entity.backedOffUntil = null;
            }
        }
    });

    /**
     * Reads the row of a job.
     * @param name - The job.
     * @returns Its row.
     */
    async function findRow(name: string): Promise<CronJobEntity> {
        return await rows.findOne({ where: { name } });
    }

    describe('with a retry', () => {
        it('runs the slot again until it succeeds, and counts no failure', async () => {
            retrying.failuresAhead = 2;

            await retrying.runOnTick(new Date());

            expect(retrying.ticks).toBe(3);
            expect((await findRow('retrying')).consecutiveFailures).toBe(0);
        });

        it('gives up after its attempts, and counts the slot as one failure', async () => {
            retrying.failuresAhead = 5;

            await retrying.runOnTick(new Date());

            expect(retrying.ticks).toBe(3);
            expect((await findRow('retrying')).consecutiveFailures).toBe(1);
        });

        it('starts no attempt once the next slot is due', async () => {
            retryingPastTheNextSlot.failuresAhead = 1;

            await retryingPastTheNextSlot.runOnTick(new Date());

            expect(retryingPastTheNextSlot.ticks).toBe(1);
            expect((await findRow('retrying-past-the-next-slot')).consecutiveFailures).toBe(1);
        });
    });

    describe('with a budget', () => {
        it('stops after as many failures in a row as it allows, and not before', async () => {
            stopping.failuresAhead = 3;

            await stopping.runOnTick(new Date());
            await stopping.runOnTick(new Date());
            expect(stopping.state).toBe(CronJobState.ACTIVE);

            await stopping.runOnTick(new Date());
            expect(stopping.state).toBe(CronJobState.STOPPED_ON_ERROR);
            expect(await findRow('stopping')).toMatchObject({
                state: CronJobState.STOPPED_ON_ERROR,
                previousState: CronJobState.ACTIVE,
                consecutiveFailures: 3
            });
        });

        it('starts counting again after a tick that succeeds', async () => {
            stopping.failuresAhead = 2;
            await stopping.runOnTick(new Date());
            await stopping.runOnTick(new Date());
            await stopping.runOnTick(new Date());

            stopping.failuresAhead = 2;
            await stopping.runOnTick(new Date());
            await stopping.runOnTick(new Date());

            expect(stopping.state).toBe(CronJobState.ACTIVE);
            expect((await findRow('stopping')).consecutiveFailures).toBe(2);
        });

        it('counts the failures of every instance', async () => {
            // the two slots before failed on another instance
            await rows.updateAll({ name: 'stopping' }, { consecutiveFailures: 2 });
            stopping.failuresAhead = 1;

            await stopping.runOnTick(new Date());

            expect(stopping.state).toBe(CronJobState.STOPPED_ON_ERROR);
        });
    });

    describe('with a cooldown', () => {
        it('puts a stopped job back on the schedule once the cooldown has passed, and stops it again at its next failure', async () => {
            stopping.failuresAhead = 3;
            for (let i: number = 0; i < 3; i++) {
                await stopping.runOnTick(new Date());
            }
            await rows.updateAll({ name: 'stopping' }, { lastRun: new Date(Date.now() - (2 * Ms.HOUR)) });

            await cronService.applyStoredChanges();

            expect(stopping.state).toBe(CronJobState.ACTIVE);
            expect((await findRow('stopping')).state).toBe(CronJobState.ACTIVE);

            stopping.failuresAhead = 1;
            await stopping.runOnTick(new Date());
            expect(stopping.state).toBe(CronJobState.STOPPED_ON_ERROR);
        });

        it('leaves a stopped job stopped while the cooldown runs', async () => {
            stopping.failuresAhead = 3;
            for (let i: number = 0; i < 3; i++) {
                await stopping.runOnTick(new Date());
            }

            await cronService.applyStoredChanges();

            expect(stopping.state).toBe(CronJobState.STOPPED_ON_ERROR);
        });

        it('leaves a job somebody turned off turned off', async () => {
            await rows.updateAll({ name: 'stopping' }, { state: CronJobState.INACTIVE, lastRun: new Date(Date.now() - (2 * Ms.HOUR)) });

            await cronService.applyStoredChanges();

            expect(stopping.state).toBe(CronJobState.INACTIVE);
        });

        it('puts a job back that keeps no row', async () => {
            localStopping.failuresAhead = 1;
            await localStopping.runOnTick(new Date());
            expect(localStopping.state).toBe(CronJobState.STOPPED_ON_ERROR);
            const local: CronJobEntity | undefined = localStopping['entity'];
            if (local) {
                local.lastRun = new Date(Date.now() - (2 * Ms.HOUR));
            }

            await cronService.applyStoredChanges();

            expect(localStopping.state).toBe(CronJobState.ACTIVE);
        });
    });

    describe('with a back off', () => {
        // the slots are counted from the failure on, which happens now: a tick runs at its slot
        it('skips the next slot after a first failure', async () => {
            const slots: Date[] = backingOff['task']?.getNextRuns(2) ?? [];
            backingOff.failuresAhead = 1;

            await backingOff.runOnTick(new Date());
            expect((await findRow('backing-off')).backedOffUntil).toEqual(slots[1]);

            await backingOff.runOnTick(slots[0]);
            expect(backingOff.ticks).toBe(1);
            await backingOff.runOnTick(slots[1]);
            expect(backingOff.ticks).toBe(2);
        });

        it('skips 3 slots after a second failure, cut down to the most it allows', async () => {
            const slots: Date[] = backingOff['task']?.getNextRuns(3) ?? [];
            await rows.updateAll({ name: 'backing-off' }, { consecutiveFailures: 1 });
            backingOff.failuresAhead = 1;

            await backingOff.runOnTick(new Date());

            expect((await findRow('backing-off')).backedOffUntil).toEqual(slots[2]);
        });

        it('skips no more than it allows however often it failed', async () => {
            const slots: Date[] = backingOff['task']?.getNextRuns(3) ?? [];
            await rows.updateAll({ name: 'backing-off' }, { consecutiveFailures: 40 });
            backingOff.failuresAhead = 1;

            await backingOff.runOnTick(new Date());

            expect((await findRow('backing-off')).backedOffUntil).toEqual(slots[2]);
        });

        it('runs every slot again after a tick that succeeds', async () => {
            const slots: Date[] = backingOff['task']?.getNextRuns(3) ?? [];
            backingOff.failuresAhead = 1;
            await backingOff.runOnTick(new Date());

            await backingOff.runOnTick(slots[1]);
            await backingOff.runOnTick(slots[2]);

            expect(backingOff.ticks).toBe(3);
            expect((await findRow('backing-off')).backedOffUntil).toBeFalsy();
        });

        it('skips a slot another instance backed off from', async () => {
            await rows.updateAll({ name: 'backing-off' }, { consecutiveFailures: 1, backedOffUntil: new Date(Date.now() + (Ms.DAY * 30)) });

            await backingOff.runOnTick(new Date());

            expect(backingOff.ticks).toBe(0);
        });
    });
});