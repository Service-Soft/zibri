import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { CronExpression, CronExpressionString } from './cron-expression.utilities';
import { CronJobEntity, CreateCronJobEntityData, CronJobState } from './cron-job-entity.model';
import { CronJob, InitialCronConfig } from './cron-job.model';
import { CronService } from './cron.service';
import { noOp } from '../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../__testing__/test-server/start-and-stop-test-server-without.function';
import { startTestServer, StartedTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZibriApplication } from '../application/application';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { Ms } from '../utilities/ms';

// ---------- Helpers ----------

function makeCronJob(config: Partial<InitialCronConfig> & { onTickImpl?: () => void | Promise<void> }): CronJob {
    const { onTickImpl, ...cronConfig } = config;
    class TestCronJob extends CronJob {
        readonly initialConfig: InitialCronConfig = {
            name: 'test-cron-job',
            cron: CronExpression.every(1, 'minutes').build(),
            runOnInit: false,
            onFailure: { stopAfterFailures: 1 },
            syncToDataSource: true,
            ...cronConfig
        };

        override onTick(): void | Promise<void> {
            return onTickImpl?.();
        }
    }
    return new TestCronJob();
}

// Backdates a job's last run, which is the only way to stage an outage without waiting for one.
// Reaches for the entity rather than the repository because the job holds it in memory and reads it
// from there; writing only the row would leave the two disagreeing.
function backdateLastRun(job: CronJob, lastRun: Date): void {
    const entity: CronJobEntity | undefined = job['entity'];
    if (!entity) {
        throw new Error('the job has to be scheduled before its last run can be staged');
    }
    entity.lastRun = lastRun;
}

// Declares nothing but the two required values, so what it ends up with is what a job gets by
// default. makeCronJob cannot answer that: it fills both flags in its own base config.
class BarelyConfiguredCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'barely-configured',
        cron: CronExpression.every(1, 'minutes').build()
    };

    override onTick(): void {}
}

// Every other test in this file boots with `cronJobs: []` and calls cronService.schedule() directly,
// which never exercises afterAppInit's own auto-registration loop (the one driven by
// ZibriApplicationOptions.cronJobs) — used by the last nested describe below, via reInit().
class AutoRegisteredCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'auto-registered-job',
        cron: CronExpression.every(1, 'minutes').build(),
        runOnInit: false,
        onFailure: { stopAfterFailures: 1 },
        syncToDataSource: true
    };

    override onTick(): void {}
}

// Every describe below needs the real server/DI state set up here — wrapped in one outer describe so
// these hooks are scoped to it (Jest cascades beforeEach/beforeAll to nested describes, not to sibling
// ones declared elsewhere in the file), including afterAppInit's reInit() call further down, which
// invalidates every previously-injected reference.
// first, for the reason on startAndStopTestServerWithout
describe('CronService — starting', () => {
    it('refuses to start without CronJobEntity, and names it', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([CronJobEntity], {
            // the harness stubs the scheduler
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })]
        });

        await expect(start).rejects.toThrow(/Error initializing CronService[\S\s]*CronJobEntity/);
    }, 30000);
});

describe('CronService / CronJob — real server', () => {
    let server: StartedTestServer;
    let cronService: CronService;
    let cronJobRepo: Repository<CronJobEntity, CreateCronJobEntityData>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [
                createTestDataSource({
                    entities: [...defaultTestServerEntities, CronJobEntity]
                })
            ],
            controllers: [],
            cronJobs: [],
            // the shared providers replace CRON_SERVICE with an inert stub, and these tests drive a
            // real service by hand - scheduling jobs and calling afterAppStart() themselves. Naming
            // it here is what builds one and runs its own hooks: without it the class is resolved on
            // first use, which is a service that never initialized and cannot say so.
            additionalLifecycleServices: [CronService]
        });
        await server.start();
        cronService = inject(CronService);
        cronJobRepo = inject(repositoryTokenFor(CronJobEntity));
    }, 30000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    beforeEach(async () => {
        await cronJobRepo.deleteAll({});
        // Stop and clear all cron jobs between tests
        for (const job of cronService.cronJobs) {
            await job.shutdown();
        }
        cronService.cronJobs.length = 0;
    });

    // ---------- Tests ----------

    describe('CronJob initialization', () => {
        it('creates a new entity in the DB when none exists', async () => {
            const job: CronJob = makeCronJob({ name: 'init-test', syncToDataSource: true, runOnInit: false });
            await cronService.schedule(job);

            const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'init-test' }, required: false });
            expect(entity).toBeDefined();
            expect(entity?.name).toBe('init-test');
            expect(entity?.state).toBe(CronJobState.ACTIVE);
        });

        it('defaults to neither running at startup nor stopping on an error', () => {
            const job: CronJob = new BarelyConfiguredCronJob();

            // both defaults used to be the dangerous one: every replica fired every job on every
            // boot, and one transient failure took a job off the schedule for good
            expect(job['fullInitialConfig'].runOnInit).toBe(false);
            expect(job['fullInitialConfig'].onFailure).toEqual({});
        });

        it('takes runOnInit from the class rather than from the stored row', async () => {
            // the row is a copy of what the class declares about how the job behaves, not the truth
            // about it - otherwise editing the declaration changes nothing in any deployment that has
            // booted once, which is every deployment that has been running longest
            await cronJobRepo.create({
                name: 'declaration-wins',
                source: 'code',
                cron: CronExpression.every(1, 'minutes').build(),
                timezone: 'UTC',
                state: CronJobState.ACTIVE,
                previousState: undefined,
                runOnInit: true,
                consecutiveFailures: 0,
                lastRun: undefined,
                errorMessage: undefined
            });

            const job: CronJob = makeCronJob({
                name: 'declaration-wins',
                syncToDataSource: true,
                runOnInit: false,
                onFailure: {}
            });
            await cronService.schedule(job);

            const entity: CronJobEntity | undefined = await cronJobRepo.findOne({
                where: { name: 'declaration-wins' },
                required: false
            });
            expect(entity?.runOnInit).toBe(false);
        });

        it('reads the expression in the deployment default zone when the job names none', async () => {
            const job: CronJob = makeCronJob({ name: 'default-zone', syncToDataSource: true, runOnInit: false });
            await cronService.schedule(job);

            const entity: CronJobEntity | undefined = await cronJobRepo.findOne({
                where: { name: 'default-zone' },
                required: false
            });
            // UTC rather than whatever the machine is set to, so a schedule means the same moment on
            // a laptop as in production and does not move twice a year
            expect(entity?.timezone).toBe('UTC');
        });

        it('lets a job name its own zone, which is what makes per tenant schedules expressible', async () => {
            const job: CronJob = makeCronJob({
                name: 'own-zone',
                timezone: 'Europe/Berlin',
                syncToDataSource: true,
                runOnInit: false
            });
            await cronService.schedule(job);

            const entity: CronJobEntity | undefined = await cronJobRepo.findOne({
                where: { name: 'own-zone' },
                required: false
            });
            expect(entity?.timezone).toBe('Europe/Berlin');
        });

        it('runs a job once for a slot that passed while nothing was up to run it', async () => {
            // eslint-disable-next-line typescript/typedef
            const onTickImpl = jest.fn(noOp);
            const job: CronJob = makeCronJob({
                name: 'catches-up',
                cron: CronExpression.every(1, 'seconds').build(),
                catchUpWithinMs: Ms.MINUTE,
                distributed: false,
                syncToDataSource: true,
                onTickImpl
            });

            await cronService.schedule(job);
            // a run half a minute ago, with a schedule that has named a slot every second since
            backdateLastRun(job, new Date(Date.now() - (Ms.SECOND * 30)));

            await cronService.afterAppStart();

            // one make-up run for the most recent missed slot, not one per slot the gap covered
            expect(onTickImpl).toHaveBeenCalledTimes(1);
        });

        it('leaves a job alone when nothing was missed', async () => {
            // eslint-disable-next-line typescript/typedef
            const onTickImpl = jest.fn(noOp);
            const job: CronJob = makeCronJob({
                name: 'nothing-missed',
                cron: CronExpression.daily().build(),
                catchUpWithinMs: Ms.MINUTE,
                distributed: false,
                syncToDataSource: true,
                onTickImpl
            });

            await cronService.schedule(job);
            backdateLastRun(job, new Date());

            await cronService.afterAppStart();

            expect(onTickImpl).not.toHaveBeenCalled();
        });

        it('does not catch up a job that never asked to be caught up', async () => {
            // eslint-disable-next-line typescript/typedef
            const onTickImpl = jest.fn(noOp);
            const job: CronJob = makeCronJob({
                name: 'no-catch-up',
                cron: CronExpression.every(1, 'seconds').build(),
                distributed: false,
                syncToDataSource: true,
                onTickImpl
            });

            await cronService.schedule(job);
            backdateLastRun(job, new Date(Date.now() - Ms.MINUTE));

            await cronService.afterAppStart();

            // a missed collection of this minute's metrics is not worth doing at all, which is why
            // this is something a job asks for rather than something it gets
            expect(onTickImpl).not.toHaveBeenCalled();
        });

        it('does not catch up a job that has never run', async () => {
            // eslint-disable-next-line typescript/typedef
            const onTickImpl = jest.fn(noOp);
            const job: CronJob = makeCronJob({
                name: 'never-ran',
                cron: CronExpression.every(1, 'seconds').build(),
                catchUpWithinMs: Ms.MINUTE,
                distributed: false,
                syncToDataSource: true,
                onTickImpl
            });

            await cronService.schedule(job);

            await cronService.afterAppStart();

            // there is no point to measure "since" from, and treating the whole schedule as
            // outstanding would fire every job on the first boot of every new environment
            expect(onTickImpl).not.toHaveBeenCalled();
        });

        it('makes up a missed run once across instances rather than once per instance', async () => {
            // two jobs of the same name are two replicas coming back from the same outage: both read
            // the same last run, both find the same missed slot, and the claim on that slot's own key
            // decides. Once a minute rather than once a second, so no scheduled tick lands inside
            // the test and gets counted as a make-up run.
            // eslint-disable-next-line typescript/typedef
            const onTickImpl = jest.fn(noOp);
            const first: CronJob = makeCronJob({
                name: 'catches-up-once',
                cron: CronExpression.every(1, 'minutes').build(),
                catchUpWithinMs: Ms.MINUTE * 5,
                distributed: true,
                syncToDataSource: true,
                onTickImpl
            });
            const second: CronJob = makeCronJob({
                name: 'catches-up-once',
                cron: CronExpression.every(1, 'minutes').build(),
                catchUpWithinMs: Ms.MINUTE * 5,
                distributed: true,
                syncToDataSource: true,
                onTickImpl
            });

            await cronService.schedule(first);
            await cronService.schedule(second);
            const outageStart: Date = new Date(Date.now() - (Ms.MINUTE * 2));
            backdateLastRun(first, outageStart);
            backdateLastRun(second, outageStart);

            await cronService.afterAppStart();

            expect(onTickImpl).toHaveBeenCalledTimes(1);
        });

        it('keeps the schedule an operator changed at runtime', async () => {
            // the other half of the same rule: `cron` is theirs, so a boot must not take it back
            const operatorSchedule: CronExpressionString = CronExpression.every(5, 'minutes').build();
            await cronJobRepo.create({
                name: 'schedule-is-theirs',
                source: 'code',
                cron: operatorSchedule,
                timezone: 'UTC',
                state: CronJobState.ACTIVE,
                previousState: undefined,
                runOnInit: false,
                consecutiveFailures: 0,
                lastRun: undefined,
                errorMessage: undefined
            });

            const job: CronJob = makeCronJob({
                name: 'schedule-is-theirs',
                cron: CronExpression.every(1, 'minutes').build(),
                syncToDataSource: true,
                runOnInit: false
            });
            await cronService.schedule(job);

            const entity: CronJobEntity | undefined = await cronJobRepo.findOne({
                where: { name: 'schedule-is-theirs' },
                required: false
            });
            expect(entity?.cron).toBe(operatorSchedule);
        });

        it('reuses an existing entity from the DB', async () => {
            // Pre-create entity that an operator has turned off
            await cronJobRepo.create({
                name: 'reuse-test',
                source: 'code',
                cron: CronExpression.every(1, 'minutes').build(),
                timezone: 'UTC',
                state: CronJobState.INACTIVE,
                previousState: undefined,
                runOnInit: false,
                consecutiveFailures: 0,
                lastRun: undefined,
                errorMessage: undefined
            });

            const job: CronJob = makeCronJob({ name: 'reuse-test', syncToDataSource: true, runOnInit: false });
            await cronService.schedule(job);

            // Should have picked up active: false from DB, not defaulted to true
            expect(job.active).toBe(false);

            // Should not have created a duplicate
            const entities: CronJobEntity[] = await cronJobRepo.findAll({ where: { name: 'reuse-test' } });
            expect(entities).toHaveLength(1);
        });

        it('calls onTick immediately when runOnInit is true', async () => {
            // eslint-disable-next-line typescript/typedef
            const onTickImpl = jest.fn(noOp);
            const job: CronJob = makeCronJob({ name: 'run-on-init', runOnInit: true, syncToDataSource: false, onTickImpl });
            await cronService.schedule(job);

            expect(onTickImpl).toHaveBeenCalledTimes(1);
        });

        it('does not call onTick on init when runOnInit is false', async () => {
            // eslint-disable-next-line typescript/typedef
            const onTickImpl = jest.fn(noOp);
            const job: CronJob = makeCronJob({ name: 'no-run-on-init', runOnInit: false, syncToDataSource: false, onTickImpl });
            await cronService.schedule(job);

            expect(onTickImpl).not.toHaveBeenCalled();
        });

        it('does not call onTick on init when nothing asked it to', async () => {
            const job: CronJob = new BarelyConfiguredCronJob();
            // eslint-disable-next-line typescript/typedef
            const onTick = jest.spyOn(job, 'onTick');
            await cronService.schedule(job);

            // the default used to be the other way, so every pod restart, scale-out and rolling
            // deploy fired every job off-schedule - once per replica
            expect(onTick).not.toHaveBeenCalled();
        });

        it('runs the startup run once across instances rather than once per instance', async () => {
            // two jobs of the same name are two replicas of the same deployment as far as the
            // election is concerned: both boot, both want the startup run, and the claim decides.
            // `task.execute()` used to run whatever it was given without asking anybody, so opting
            // in meant one execution per replica no matter what `distributed` said.
            // eslint-disable-next-line typescript/typedef
            const onTickImpl = jest.fn(noOp);
            const first: CronJob = makeCronJob({
                name: 'startup-elected',
                runOnInit: true,
                distributed: true,
                syncToDataSource: true,
                onTickImpl
            });
            const second: CronJob = makeCronJob({
                name: 'startup-elected',
                runOnInit: true,
                distributed: true,
                syncToDataSource: true,
                onTickImpl
            });

            await cronService.schedule(first);
            await cronService.schedule(second);

            expect(onTickImpl).toHaveBeenCalledTimes(1);
        });

        it('runs the startup run on every instance for a job each instance owes for itself', async () => {
            // the opposite case, and the reason the election is not unconditional: collecting this
            // process's metrics or clearing this container's temp folder has to happen everywhere
            // eslint-disable-next-line typescript/typedef
            const onTickImpl = jest.fn(noOp);
            const first: CronJob = makeCronJob({
                name: 'startup-per-instance',
                runOnInit: true,
                distributed: false,
                syncToDataSource: true,
                onTickImpl
            });
            const second: CronJob = makeCronJob({
                name: 'startup-per-instance',
                runOnInit: true,
                distributed: false,
                syncToDataSource: true,
                onTickImpl
            });

            await cronService.schedule(first);
            await cronService.schedule(second);

            expect(onTickImpl).toHaveBeenCalledTimes(2);
        });

        it('throws if initialized twice', async () => {
            const job: CronJob = makeCronJob({ name: 'double-init', syncToDataSource: false, runOnInit: false });
            await cronService.schedule(job);

            await expect(
                cronService.schedule(job)
            ).rejects.toThrow('already been initialized');
        });
    });

    describe('CronJob tick behavior', () => {
        it('calls onTick and updates lastRun', async () => {
            // eslint-disable-next-line typescript/typedef
            const onTickImpl = jest.fn(noOp);
            const job: CronJob = makeCronJob({ name: 'tick-test', syncToDataSource: true, runOnInit: false, onTickImpl });
            await cronService.schedule(job);

            await job.runOnTick();

            expect(onTickImpl).toHaveBeenCalledTimes(1);
            expect(job['entity']?.lastRun).toBeInstanceOf(Date);
        });

        it('persists lastRun to DB when syncToDataSource is true', async () => {
            const job: CronJob = makeCronJob({ name: 'tick-persist', syncToDataSource: true, runOnInit: false });
            await cronService.schedule(job);

            await job.runOnTick();

            const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'tick-persist' }, required: false });
            expect(entity?.lastRun).toBeInstanceOf(Date);
        });

        it('does not persist lastRun to DB when syncToDataSource is false', async () => {
            const job: CronJob = makeCronJob({ name: 'tick-no-persist', syncToDataSource: false, runOnInit: false });
            await cronService.schedule(job);

            await job.runOnTick();

            // No entity should exist in the DB
            const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'tick-no-persist' }, required: false });
            expect(entity).toBeUndefined();
        });
    });

    describe('CronJob error behavior', () => {
        it('sets errorMessage when onTick throws', async () => {
            const job: CronJob = makeCronJob({
                name: 'error-test',
                syncToDataSource: false,
                runOnInit: false,
                onFailure: {},
                onTickImpl: () => {
                    throw new Error('boom');
                }
            });
            await cronService.schedule(job);

            await job.runOnTick();

            expect(job['entity']?.errorMessage).toContain('boom');
        });

        it('stops the job when onTick throws as often in a row as onFailure allows', async () => {
            const job: CronJob = makeCronJob({
                name: 'stop-on-error',
                syncToDataSource: false,
                runOnInit: false,
                onFailure: { stopAfterFailures: 1 },
                onTickImpl: () => {
                    throw new Error('fatal');
                }
            });
            await cronService.schedule(job);

            await job.runOnTick();

            expect(job.active).toBe(false);
            expect(job.state).toBe(CronJobState.STOPPED_ON_ERROR);
        });

        it('records where to put the job back, so a stop is told apart from a deliberate disable', async () => {
            const job: CronJob = makeCronJob({
                name: 'stop-records-previous',
                syncToDataSource: true,
                runOnInit: false,
                onFailure: { stopAfterFailures: 1 },
                onTickImpl: () => {
                    throw new Error('fatal');
                }
            });
            await cronService.schedule(job);

            await job.runOnTick();

            const entity: CronJobEntity | undefined = await cronJobRepo.findOne({
                where: { name: 'stop-records-previous' },
                required: false
            });
            expect(entity?.state).toBe(CronJobState.STOPPED_ON_ERROR);
            expect(entity?.previousState).toBe(CronJobState.ACTIVE);
        });

        it('puts a job the framework stopped back on the schedule at the next start', async () => {
            // the restart is the retry: whatever made this boot happen - a deploy, a failover, a
            // configuration change - is the same class of event that would have fixed the failure
            await cronJobRepo.create({
                name: 'recovers-on-boot',
                source: 'code',
                cron: CronExpression.every(1, 'minutes').build(),
                timezone: 'UTC',
                state: CronJobState.STOPPED_ON_ERROR,
                previousState: CronJobState.ACTIVE,
                runOnInit: false,
                consecutiveFailures: 1,
                lastRun: undefined,
                errorMessage: 'the failure that stopped it'
            });

            const job: CronJob = makeCronJob({
                name: 'recovers-on-boot',
                syncToDataSource: true,
                runOnInit: false,
                onFailure: { stopAfterFailures: 1 }
            });
            await cronService.schedule(job);

            expect(job.state).toBe(CronJobState.ACTIVE);

            const entity: CronJobEntity | undefined = await cronJobRepo.findOne({
                where: { name: 'recovers-on-boot' },
                required: false
            });
            expect(entity?.state).toBe(CronJobState.ACTIVE);
            expect(entity?.previousState).toBeFalsy();
            // what happened stays readable, which is the whole reason to recover rather than to forget
            expect(entity?.errorMessage).toBe('the failure that stopped it');
        });

        it('leaves a job somebody turned off turned off', async () => {
            await cronJobRepo.create({
                name: 'stays-disabled',
                source: 'code',
                cron: CronExpression.every(1, 'minutes').build(),
                timezone: 'UTC',
                state: CronJobState.INACTIVE,
                previousState: undefined,
                runOnInit: false,
                consecutiveFailures: 0,
                lastRun: undefined,
                errorMessage: undefined
            });

            const job: CronJob = makeCronJob({ name: 'stays-disabled', syncToDataSource: true, runOnInit: false, onFailure: {} });
            await cronService.schedule(job);

            expect(job.state).toBe(CronJobState.INACTIVE);
        });

        it('does not stop the job when onFailure asks for no stop and onTick throws', async () => {
            const job: CronJob = makeCronJob({
                name: 'no-stop-on-error',
                syncToDataSource: false,
                runOnInit: false,
                onFailure: {},
                onTickImpl: () => {
                    throw new Error('non-fatal');
                }
            });
            await cronService.schedule(job);

            await job.runOnTick();

            expect(job.active).toBe(true);
        });

        it('persists errorMessage to DB when syncToDataSource is true', async () => {
            const job: CronJob = makeCronJob({
                name: 'error-persist',
                syncToDataSource: true,
                runOnInit: false,
                onFailure: {},
                onTickImpl: () => {
                    throw new Error('db-error');
                }
            });
            await cronService.schedule(job);

            await job.runOnTick();

            const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'error-persist' }, required: false });
            expect(entity?.errorMessage).toContain('db-error');
        });
    });

    describe('CronJob enable/disable', () => {
        it('disable sets active to false', async () => {
            const job: CronJob = makeCronJob({ name: 'disable-test', syncToDataSource: false, runOnInit: false });
            await cronService.schedule(job);

            await job.disable();

            expect(job.active).toBe(false);
        });

        it('enable sets active to true after disable', async () => {
            const job: CronJob = makeCronJob({ name: 'enable-test', syncToDataSource: false, runOnInit: false });
            await cronService.schedule(job);

            await job.disable();
            await job.enable();

            expect(job.active).toBe(true);
        });

        it('persists active state to DB on disable', async () => {
            const job: CronJob = makeCronJob({ name: 'disable-persist', syncToDataSource: true, runOnInit: false });
            await cronService.schedule(job);

            await job.disable();

            const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'disable-persist' }, required: false });
            expect(entity?.state).toBe(CronJobState.INACTIVE);
        });

        it('persists active state to DB on enable', async () => {
            const job: CronJob = makeCronJob({ name: 'enable-persist', syncToDataSource: true, runOnInit: false });
            await cronService.schedule(job);

            await job.disable();
            await job.enable();

            const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'enable-persist' }, required: false });
            expect(entity?.state).toBe(CronJobState.ACTIVE);
        });
    });

    describe('CronService', () => {
        it('schedule adds the job to cronJobs', async () => {
            const job: CronJob = makeCronJob({ name: 'schedule-test', syncToDataSource: false, runOnInit: false });
            await cronService.schedule(job);

            expect(cronService.cronJobs).toContain(job);
        });

        it('enable enables a job by name', async () => {
            const job: CronJob = makeCronJob({ name: 'service-enable', syncToDataSource: false, runOnInit: false });
            await cronService.schedule(job);
            await job.disable();

            await cronService.enable('service-enable');

            expect(job.active).toBe(true);
        });

        it('disable disables a job by name', async () => {
            const job: CronJob = makeCronJob({ name: 'service-disable', syncToDataSource: false, runOnInit: false });
            await cronService.schedule(job);

            await cronService.disable('service-disable');

            expect(job.active).toBe(false);
        });

        it('enable throws when job is not found', async () => {
            await expect(cronService.enable('nonexistent')).rejects.toThrow('Could not find cron job with name "nonexistent"');
        });

        it('disable throws when job is not found', async () => {
            await expect(cronService.disable('nonexistent')).rejects.toThrow('Could not find cron job with name "nonexistent"');
        });

        it('changeCron throws when job is not found', async () => {
            await expect(
                cronService.changeCron('nonexistent', CronExpression.every(5, 'minutes').build())
            ).rejects.toThrow('Could not find cron job with name "nonexistent"');
        });

        it('changeCron updates the cron expression', async () => {
            const job: CronJob = makeCronJob({ name: 'change-cron', syncToDataSource: true, runOnInit: false });
            await cronService.schedule(job);

            const newCron: CronExpressionString = CronExpression.every(10, 'minutes').build();
            await cronService.changeCron('change-cron', newCron);

            const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'change-cron' }, required: false });
            expect(entity?.cron).toBe(newCron);
        });

        it('update throws when job is not found', async () => {
            await expect(cronService.update('nonexistent', { name: 'other' })).rejects.toThrow('Could not find cron job with name "nonexistent"');
        });

        it('update refuses a job declared in code, and leaves its row as it was', async () => {
            const job: CronJob = makeCronJob({ name: 'update-test', syncToDataSource: true, runOnInit: false });
            await cronService.schedule(job);

            // the class declares what update would change, and each start takes it back from there (04 §2.15)
            await expect(cronService.update('update-test', { runOnInit: true })).rejects.toThrow('is declared in code');

            const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'update-test' }, required: false });
            expect(entity?.runOnInit).toBe(false);
        });

        it('update throws when renaming to an already-used name', async () => {
            const job1: CronJob = makeCronJob({ name: 'taken-name', syncToDataSource: false, runOnInit: false });
            const job2: CronJob = makeCronJob({ name: 'rename-source', syncToDataSource: false, runOnInit: false });
            await cronService.schedule(job1);
            await cronService.schedule(job2);

            await expect(cronService.update('rename-source', { name: 'taken-name' })).rejects.toThrow();
        });
    });

    describe('CronService.afterAppInit — auto-registration from ZibriApplicationOptions.cronJobs', () => {
        // reInit() re-initializes the *same* running app/container with different options, reusing the
        // existing container rather than starting a second, independent one (which would fail — see the
        // comment on the outer describe). Placed last in this file: it invalidates every previously
        // injected reference, including this describe's own outer cronService/cronJobRepo — both assertions
        // live in one test so no beforeEach runs against those stale references in between.
        //
        // The test server's default CRON_SERVICE provider replaces CronService with a plain mock object
        // (see defaultTestServerProviders) so that the rest of this file can inject a lazily-constructed
        // CronService directly without going through afterAppInit. That mock has no afterAppInit method and
        // is never part of the app's eager-token snapshot, so the framework's real auto-registration lifecycle
        // never runs against it. Restoring the real class for this one token, for this one reInit call, is
        // what makes that lifecycle observable end-to-end.
        //
        // Once the real CronService is wired back in, several other default services (Logger, EmailService,
        // RateLimitingService, EventService, PrometheusMetricsService, FormDataBodyParser, JwtAuthStrategy)
        // also push their own built-in maintenance cron jobs into options.cronJobs from their onAppInit/init
        // hooks, which run before CronService.afterAppInit reads that array. So cronJobs ends up containing
        // AutoRegisteredCronJob alongside those framework built-ins — assert containment, not an exact count.
        it('registers, injects and initializes every class in options.cronJobs on boot, and guards against a second call', async () => {
            await server.reInit({
                cronJobs: [AutoRegisteredCronJob],
                providers: [
                    ...defaultTestServerProviders.filter((provider) => provider.token !== ZIBRI_DI_TOKENS.CRON_SERVICE),
                    defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
                ]
            });

            // proves register() ran: the class resolves through the real DI container, not just a manual `new`
            const injected: AutoRegisteredCronJob = inject(AutoRegisteredCronJob);
            expect(injected).toBeInstanceOf(AutoRegisteredCronJob);

            const autoCronService: CronService = inject(CronService);
            expect(autoCronService.cronJobs).toContain(injected);
            // proves init() actually ran: .active throws on an un-initialized job (see CronJobNotInitializedError)
            expect(injected.active).toBe(true);

            const autoCronJobRepo: Repository<CronJobEntity, CreateCronJobEntityData> = inject(repositoryTokenFor(CronJobEntity));
            const entity: CronJobEntity | undefined = await autoCronJobRepo.findOne({ where: { name: 'auto-registered-job' }, required: false });
            expect(entity).toBeDefined();

            // afterAppInit only reads `options.cronJobs` off the passed app — a minimal fixture is enough to
            // exercise the "already initialized" guard without needing a second full ZibriApplication boot.
            const fakeApp: ZibriApplication = { options: { cronJobs: [] } } as unknown as ZibriApplication;
            await expect(autoCronService.afterAppInit(fakeApp)).rejects.toThrow('already been initialized');
        }, 15000);
    });
});