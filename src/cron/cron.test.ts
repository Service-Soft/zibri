import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { CronExpression, CronExpressionString } from './cron-expression.utilities';
import { CronJobEntity, CreateCronJobEntityData } from './cron-job-entity.model';
import { CronJob, InitialCronConfig } from './cron-job.model';
import { CronService } from './cron.service';
import { noOp } from '../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { startTestServer, StartedTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';

// ---------- Helpers ----------

function makeCronJob(config: Partial<InitialCronConfig> & { onTickImpl?: () => void | Promise<void> }): CronJob {
    const { onTickImpl, ...cronConfig } = config;
    class TestCronJob extends CronJob {
        readonly initialConfig: InitialCronConfig = {
            name: 'test-cron-job',
            cron: CronExpression.every(1, 'minutes').build(),
            runOnInit: false,
            stopOnError: true,
            syncToDataSource: true,
            ...cronConfig
        };

        override onTick(): void | Promise<void> {
            return onTickImpl?.();
        }
    }
    return new TestCronJob();
}

// ---------- Test setup ----------

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
        cronJobs: []
    });
    await server.start();
    cronService = inject(CronService);
    cronJobRepo = inject(repositoryTokenFor(CronJobEntity));
}, 15000);

afterAll(async () => {
    await server.shutdown();
});

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

        const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'init-test' } }, false);
        expect(entity).toBeDefined();
        expect(entity?.name).toBe('init-test');
        expect(entity?.active).toBe(true);
    });

    it('reuses an existing entity from the DB', async () => {
        // Pre-create entity with active: false
        await cronJobRepo.create({
            name: 'reuse-test',
            cron: CronExpression.every(1, 'minutes').build(),
            active: false,
            runOnInit: false,
            stopOnError: true,
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

        const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'tick-persist' } }, false);
        expect(entity?.lastRun).toBeInstanceOf(Date);
    });

    it('does not persist lastRun to DB when syncToDataSource is false', async () => {
        const job: CronJob = makeCronJob({ name: 'tick-no-persist', syncToDataSource: false, runOnInit: false });
        await cronService.schedule(job);

        await job.runOnTick();

        // No entity should exist in the DB
        const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'tick-no-persist' } }, false);
        expect(entity).toBeUndefined();
    });
});

describe('CronJob error behavior', () => {
    it('sets errorMessage when onTick throws', async () => {
        const job: CronJob = makeCronJob({
            name: 'error-test',
            syncToDataSource: false,
            runOnInit: false,
            stopOnError: false,
            onTickImpl: () => {
                throw new Error('boom');
            }
        });
        await cronService.schedule(job);

        await job.runOnTick();

        expect(job['entity']?.errorMessage).toContain('boom');
    });

    it('disables the job when stopOnError is true and onTick throws', async () => {
        const job: CronJob = makeCronJob({
            name: 'stop-on-error',
            syncToDataSource: false,
            runOnInit: false,
            stopOnError: true,
            onTickImpl: () => {
                throw new Error('fatal');
            }
        });
        await cronService.schedule(job);

        await job.runOnTick();

        expect(job.active).toBe(false);
    });

    it('does not disable the job when stopOnError is false and onTick throws', async () => {
        const job: CronJob = makeCronJob({
            name: 'no-stop-on-error',
            syncToDataSource: false,
            runOnInit: false,
            stopOnError: false,
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
            stopOnError: false,
            onTickImpl: () => {
                throw new Error('db-error');
            }
        });
        await cronService.schedule(job);

        await job.runOnTick();

        const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'error-persist' } }, false);
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

        const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'disable-persist' } }, false);
        expect(entity?.active).toBe(false);
    });

    it('persists active state to DB on enable', async () => {
        const job: CronJob = makeCronJob({ name: 'enable-persist', syncToDataSource: true, runOnInit: false });
        await cronService.schedule(job);

        await job.disable();
        await job.enable();

        const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'enable-persist' } }, false);
        expect(entity?.active).toBe(true);
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

        const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'change-cron' } }, false);
        expect(entity?.cron).toBe(newCron);
    });

    it('update throws when job is not found', async () => {
        await expect(cronService.update('nonexistent', { name: 'other' })).rejects.toThrow('Could not find cron job with name "nonexistent"');
    });

    it('update applies data to the job', async () => {
        const job: CronJob = makeCronJob({ name: 'update-test', syncToDataSource: true, runOnInit: false });
        await cronService.schedule(job);

        await cronService.update('update-test', { runOnInit: false, stopOnError: false });

        const entity: CronJobEntity | undefined = await cronJobRepo.findOne({ where: { name: 'update-test' } }, false);
        expect(entity?.stopOnError).toBe(false);
    });

    it('update throws when renaming to an already-used name', async () => {
        const job1: CronJob = makeCronJob({ name: 'taken-name', syncToDataSource: false, runOnInit: false });
        const job2: CronJob = makeCronJob({ name: 'rename-source', syncToDataSource: false, runOnInit: false });
        await cronService.schedule(job1);
        await cronService.schedule(job2);

        await expect(cronService.update('rename-source', { name: 'taken-name' })).rejects.toThrow();
    });
});

describe('CronExpression', () => {
    it('every(5, minutes) produces correct expression', () => {
        expect(CronExpression.every(5, 'minutes').build()).toBe('* */5 * * * *');
    });

    it('every(1, minutes) produces wildcard, not */1', () => {
        expect(CronExpression.every(1, 'minutes').build()).toBe('* * * * * *');
    });

    it('daily() defaults to midnight', () => {
        expect(CronExpression.daily().build()).toBe('0 0 0 * * *');
    });

    it('daily().at(9, hours) produces correct expression', () => {
        expect(CronExpression.daily().at(9, 'hours')
            .build()).toBe('0 0 9 * * *');
    });

    it('daily().at(9, hours).at(30, minutes) produces correct expression', () => {
        expect(CronExpression.daily().at(9, 'hours')
            .at(30, 'minutes')
            .build()).toBe('0 30 9 * * *');
    });

    it('weekly() defaults to Sunday midnight', () => {
        expect(CronExpression.weekly().build()).toBe('0 0 0 * * 0');
    });

    it('weekly().on(Monday) produces correct expression', () => {
        expect(CronExpression.weekly().on('Monday')
            .build()).toBe('0 0 0 * * 1');
    });

    it('daily().on(Monday, Wednesday, Friday) produces correct expression', () => {
        expect(CronExpression.daily().on('Monday', 'Wednesday', 'Friday')
            .build()).toBe('0 0 0 * * 1,3,5');
    });

    it('monthly() defaults to 1st at midnight', () => {
        expect(CronExpression.monthly().build()).toBe('0 0 0 1 * *');
    });

    it('monthly().in(March, June) produces correct expression', () => {
        expect(CronExpression.monthly().in('March', 'June')
            .build()).toBe('0 0 0 1 3,6 *');
    });

    it('between() restricts to a range', () => {
        expect(CronExpression.every(1, 'minutes').between(9, 17, 'hours')
            .build()).toBe('* * 9-17 * * *');
    });

    it('between() throws when from >= to', () => {
        expect(() => CronExpression.every(1, 'minutes').between(17, 9, 'hours')).toThrow(RangeError);
    });

    it('fromString() round-trips a valid expression', () => {
        const expr: string = '0 30 9 * * 1';
        expect(CronExpression.fromString(expr)).toBe(expr);
    });

    it('fromString() throws for wrong field count', () => {
        expect(() => CronExpression.fromString('* * * *')).toThrow('Expected 6 fields');
    });
});