import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { CronExpression, CronExpressionString } from './cron-expression.utilities';
import { CreateCronJobEntityData, CronJobEntity, CronJobState } from './cron-job-entity.model';
import { CronJob, InitialCronConfig } from './cron-job.model';
import { CronService } from './cron.service';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { DiProvider, defineProvider } from '../di/models/di-provider.model';
import { Newable } from '../types/newable.type';

/**
 * Once a year at 03:00, so no tick fires while the cases run.
 */
const YEARLY_AT_0300: CronExpressionString = CronExpression.fromString('0 0 3 1 1 *');

/**
 * Once a year at 04:00, the schedule the class is edited to.
 */
const YEARLY_AT_0400: CronExpressionString = CronExpression.fromString('0 0 4 1 1 *');

/**
 * Once a year at 05:00, the schedule an operator moves the job to.
 */
const YEARLY_AT_0500: CronExpressionString = CronExpression.fromString('0 0 5 1 1 *');

/**
 * A job class as one version of the application declares it. Two calls with the same name are the
 * same job before and after an edit of its class.
 * @param config - What this version of the class declares.
 * @returns The job class.
 */
function declareJob(config: InitialCronConfig): Newable<CronJob> {
    return class extends CronJob {
        readonly initialConfig: InitialCronConfig = config;

        override onTick(): void {}
    };
}

// in memory, whose store belongs to the data source class: a reInit is a restart on the same rows
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, CronJobEntity],
    repositories: defaultTestServerRepositories
});

// the shared providers stub the cron service
const providers: DiProvider<unknown>[] = [
    ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.CRON_SERVICE),
    defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
];

describe('CronJob, after its class changed between two starts', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass], cronJobs: [], providers });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    /**
     * Restarts the application with the given job classes.
     * @param jobs - The job classes of the version that starts.
     */
    async function startWith(...jobs: Newable<CronJob>[]): Promise<void> {
        await server.reInit({ cronJobs: jobs, providers });
    }

    /**
     * Reads the stored row of a job.
     * @param name - The name of the job.
     * @returns The row.
     */
    async function findRow(name: string): Promise<CronJobEntity> {
        const rows: Repository<CronJobEntity, CreateCronJobEntityData> = inject(repositoryTokenFor(CronJobEntity));
        return await rows.findOne({ where: { name } });
    }

    it('moves the job to the schedule its class declares once the class changed it', async () => {
        await startWith(declareJob({ name: 'edited-schedule', cron: YEARLY_AT_0300 }));
        await startWith(declareJob({ name: 'edited-schedule', cron: YEARLY_AT_0400 }));

        expect((await findRow('edited-schedule')).cron).toBe(YEARLY_AT_0400);
        const job: CronJob | undefined = inject(CronService).cronJobs.find(j => j.name === 'edited-schedule');
        expect(job?.matches(new Date('2027-01-01T04:00:00Z'))).toBe(true);
        expect(job?.matches(new Date('2027-01-01T03:00:00Z'))).toBe(false);
    }, TestTimeouts.inMemory.restart);

    it('says which schedule the class replaced', async () => {
        await startWith(declareJob({ name: 'logged-schedule', cron: YEARLY_AT_0300 }));
        await startWith(declareJob({ name: 'logged-schedule', cron: YEARLY_AT_0400 }));

        expect(server.bootLog).toContainEqual(expect.stringContaining(
            `cron job "logged-schedule": schedule '${YEARLY_AT_0300}' replaced by '${YEARLY_AT_0400}', declared in code`
        ));
    }, TestTimeouts.inMemory.restart);

    it('keeps the schedule an operator changed while the class declares the same one', async () => {
        await startWith(declareJob({ name: 'operator-schedule', cron: YEARLY_AT_0300 }));
        await inject(CronService).changeCron('operator-schedule', YEARLY_AT_0500);
        await startWith(declareJob({ name: 'operator-schedule', cron: YEARLY_AT_0300 }));

        expect((await findRow('operator-schedule')).cron).toBe(YEARLY_AT_0500);
    }, TestTimeouts.inMemory.restart);

    it('replaces the schedule an operator changed once the class changed it', async () => {
        await startWith(declareJob({ name: 'overridden-schedule', cron: YEARLY_AT_0300 }));
        await inject(CronService).changeCron('overridden-schedule', YEARLY_AT_0500);
        await startWith(declareJob({ name: 'overridden-schedule', cron: YEARLY_AT_0400 }));

        expect((await findRow('overridden-schedule')).cron).toBe(YEARLY_AT_0400);
    }, TestTimeouts.inMemory.restart);

    it('puts the job on the schedule once its class changed active', async () => {
        await startWith(declareJob({ name: 'edited-active', cron: YEARLY_AT_0300, active: false }));
        await startWith(declareJob({ name: 'edited-active', cron: YEARLY_AT_0300, active: true }));

        expect((await findRow('edited-active')).state).toBe(CronJobState.ACTIVE);
    }, TestTimeouts.inMemory.restart);

    it('takes the job off the schedule once its class changed active', async () => {
        await startWith(declareJob({ name: 'deactivated', cron: YEARLY_AT_0300, active: true }));
        await startWith(declareJob({ name: 'deactivated', cron: YEARLY_AT_0300, active: false }));

        expect((await findRow('deactivated')).state).toBe(CronJobState.INACTIVE);
    }, TestTimeouts.inMemory.restart);

    it('keeps a job an operator disabled off while the class declares the same', async () => {
        await startWith(declareJob({ name: 'operator-disabled', cron: YEARLY_AT_0300 }));
        await inject(CronService).disable('operator-disabled');
        await startWith(declareJob({ name: 'operator-disabled', cron: YEARLY_AT_0300 }));

        expect((await findRow('operator-disabled')).state).toBe(CronJobState.INACTIVE);
    }, TestTimeouts.inMemory.restart);

    it('keeps a row that records no declaration as it is, and follows the class from then on', async () => {
        // a row written before rows recorded what the class declared, whose values may be an
        // operator's change
        await inject(repositoryTokenFor(CronJobEntity)).create({
            name: 'undeclared-row',
            source: 'code',
            cron: YEARLY_AT_0500,
            timezone: 'UTC',
            state: CronJobState.INACTIVE,
            previousState: undefined,
            runOnInit: false,
            consecutiveFailures: 0,
            lastRun: undefined,
            errorMessage: undefined
        });

        await startWith(declareJob({ name: 'undeclared-row', cron: YEARLY_AT_0300, active: true }));
        const kept: CronJobEntity = await findRow('undeclared-row');
        expect(kept.cron).toBe(YEARLY_AT_0500);
        expect(kept.state).toBe(CronJobState.INACTIVE);

        await startWith(declareJob({ name: 'undeclared-row', cron: YEARLY_AT_0400, active: true }));
        expect((await findRow('undeclared-row')).cron).toBe(YEARLY_AT_0400);
    }, 20000);
});