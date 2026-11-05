import { CronExpressionString } from './cron-expression.utilities';
import { CreateCronJobEntityData, CronJobEntity } from './cron-job-entity.model';
import { CronJob } from './cron-job.model';
import { CronServiceInterface } from './cron-service.interface';
import { CronSyncCronJob } from './cron-sync.cron-job';
import { ExpiredRowsCleanupCronJob } from './expired-rows-cleanup.cron-job';
import { ZibriApplication } from '../application/application';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { register } from '../di/register.function';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { InternalError } from '../error-handling/internal-error.model';
import { AfterAppInit } from '../global/after-app-init.interface';
import { AfterAppStart } from '../global/after-app-start.interface';
import { BeforeAppShutdown } from '../global/before-app-shutdown.interface';
import { type LeaseServiceInterface } from '../leases/lease-service.interface';
import { $ts } from '../localization/translate.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { WAKE_UP_TOPICS } from '../polling/wake-up-topics';
import { OmitStrict } from '../types/omit-strict.type';
import { Ms } from '../utilities/ms';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';

/**
 * Data that can be used to update a cron job.
 */
export type CronUpdateData = Partial<
    OmitStrict<
        CronJobEntity,
        'id' | 'source' | 'cron' | 'declaredCron' | 'declaredActive' | 'state' | 'previousState' | 'errorMessage' | 'lastRun'
        | 'consecutiveFailures' | 'backedOffUntil'
    >
>;

/**
 * An error to throw when a cron job with the given name could not be found.
 */
class CronJobWithNameNotFoundError extends NotFoundError {
    constructor(name: string) {
        super($ts`Could not find cron job with name "${name}"`);
        this.name = 'CronJobWithNameNotFoundError';
    }
}

/**
 * Default cron service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class CronService implements CronServiceInterface, AfterAppInit, AfterAppStart, BeforeAppShutdown {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly cronJobs: CronJob[] = [];

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.LEASE_SERVICE)
        private readonly leaseService: LeaseServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async afterAppInit(app: ZibriApplication): Promise<void> {
        const { options } = app;
        const { cronJobs } = options;
        if (this.cronJobs.length) {
            throw new InternalError('has already been initialized');
        }
        // asked for even without jobs to register here, because schedule can add one to a running
        // application - and that would otherwise be the first time anything needed the table
        validateEntitiesRegistered(CronService.name, app, CronJobEntity);
        if (
            !cronJobs.includes(ExpiredRowsCleanupCronJob)
            && ExpiredRowsCleanupCronJob.hasExpiringEntities(inject(ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE).getDataSources())
        ) {
            cronJobs.push(ExpiredRowsCleanupCronJob);
        }
        if (!cronJobs.length) {
            return;
        }
        // what another instance changes about a job reaches this one through its row only
        if (!cronJobs.includes(CronSyncCronJob)) {
            cronJobs.push(CronSyncCronJob);
        }

        this.logger.info(`registers ${cronJobs.length} ${cronJobs.length > 1 ? 'cron jobs' : 'cron job'}`);

        const jobs: CronJob[] = cronJobs.map(cronJobClass => {
            register({ token: cronJobClass, useClass: cronJobClass });
            return inject(cronJobClass);
        });

        // registering a job reads its row and creates it when it is missing, and every replica boots
        // doing that for the same names. Without the grant they all read nothing, all insert, and
        // the ones the unique name refuses do not just skip the row - they fail to boot.
        //
        // Taken once around the whole loop rather than per job: the jobs have no reason to be
        // registered independently of each other, and one grant per boot is cheaper than ten. It
        // waits rather than skipping, because a replica that gave up here would start with no cron
        // jobs at all.
        await this.leaseService.withLease(
            { key: 'cron:register', leaseInMs: inject(ZIBRI_DI_TOKENS.CRON_REGISTRATION_LEASE_IN_MS), mode: 'wait' },
            async () => {
                for (const cronJob of jobs) {
                    await cronJob.init(
                        this.logger,
                        inject(repositoryTokenFor(CronJobEntity)),
                        (key: string, ttlInMs: number, run: () => Promise<void>) => this.runExecution(key, ttlInMs, run)
                    );
                    const state: string = cronJob.state.toLowerCase().replaceAll('_', ' ');
                    const scope: string = cronJob.runsOn === 'oneInstance' ? '' : ', per instance';
                    this.logger.info(`  -  ${cronJob.constructor.name} (${state}${scope})`);
                    this.cronJobs.push(cronJob);
                }
            }
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async afterAppStart(): Promise<void> {
        // registration above happens while the app is still coming up, because it reads and writes
        // the data source. Firing does not: a job that begins working here is one an operator can
        // already reach, so an instance that never becomes ready, or is rolled back, is also one
        // that never ran the nightly billing job.
        for (const cronJob of this.cronJobs) {
            await cronJob.start();
            await this.catchUpMissedRun(cronJob);
        }
    }

    /**
     * Runs a job once for a scheduled time that passed while nothing was up to run it.
     *
     * After `start`, not before: a startup run has already written `lastRun`, so a job that just ran
     * is a job with nothing outstanding and this finds nothing. Only jobs that asked for it take part
     * at all - see {@link CronJobEntity.catchUpWithinInMs}.
     *
     * The make-up run is the slot's own execution as far as the deployment is concerned: it is run
     * under the slot's key, so if any instance ran it, or is still running it, the key is held and
     * nothing happens here.
     * @param cronJob - The job to check.
     */
    private async catchUpMissedRun(cronJob: CronJob): Promise<void> {
        const withinInMs: number | undefined = cronJob.catchUpWithinInMs;
        const lastRun: Date | undefined = cronJob.lastRun;
        // a job that has never run has missed nothing - there is no point to measure "since" from,
        // and treating its whole schedule as outstanding would fire it on the first boot of every
        // new environment
        if (!withinInMs || !lastRun || !cronJob.active) {
            return;
        }

        const missed: Date | undefined = this.findMissedSlot(d => cronJob.matches(d), new Date(), lastRun, withinInMs);
        if (!missed) {
            return;
        }

        this.logger.info(`catching up cron job "${cronJob.name}", missed at ${missed.toISOString()}`);
        await cronJob.runOnTick(missed);
    }

    /**
     * Finds the most recent scheduled time that passed without the job running.
     *
     * `lastRun` is the only durable record of what happened, so anything the schedule named after it
     * is something that did not.
     *
     * Searched backwards a second at a time rather than computed, because node-cron answers "does
     * this date match" and nothing else - it can say when the next run is, never when the last one
     * was. The cost is bounded by whichever is nearer, the last run or the caller's limit, so a job
     * that has been running normally stops after a step or two and only real downtime is walked over.
     *
     * The first match going backwards is the answer: one make-up run, not one per slot the outage
     * covered. A deployment that was down for a week owes the last invoice run, not seven of them.
     * @param matches - Whether the schedule names the given moment.
     * @param now - The moment to search back from.
     * @param lastRun - When the job last ran. Nothing at or before it was missed.
     * @param withinInMs - How far back to look.
     * @returns The missed scheduled time, or undefined if nothing was missed.
     */
    private findMissedSlot(
        matches: (date: Date) => boolean,
        now: Date,
        lastRun: Date,
        withinInMs: number
    ): Date | undefined {
        const earliest: number = Math.max(lastRun.getTime(), now.getTime() - withinInMs);
        // whole seconds, because no cron expression names a moment between two of them
        const start: number = Math.floor(now.getTime() / Ms.SECOND) * Ms.SECOND;

        for (let ms: number = start; ms > earliest; ms -= Ms.SECOND) {
            const candidate: Date = new Date(ms);
            if (matches(candidate)) {
                return candidate;
            }
        }

        return undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runExecution(key: string, ttlInMs: number, run: () => Promise<void>): Promise<boolean> {
        // the run inside the grant, which is renewed underneath it for as long as it lasts: an
        // instance booting while a nightly job is in its twentieth minute finds the slot held, and
        // does not catch it up beside the run. The lease length therefore only decides how long an
        // execution whose instance died waits before another takes it over.
        //
        // 'retain', because the grant is not only an exclusion but the record that this tick has
        // been dealt with. Handing it back at the end of the run would let a replica arriving a
        // moment later win the same key and run the job a second time.
        const ran: boolean | undefined = await this.leaseService.withLease(
            { key: `cron:${key}`, leaseInMs: ttlInMs, mode: 'skip', onCompletion: 'retain' },
            async () => {
                await run();
                return true;
            }
        );

        // undefined means another instance holds this execution, which is the expected outcome on
        // every instance but one and not worth a log line
        return ran ?? false;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async beforeAppShutdown(): Promise<void> {
        await Promise.all(this.cronJobs.map(j => j.shutdown()));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async schedule(cronJob: CronJob): Promise<void> {
        await cronJob.init(
            this.logger,
            inject(repositoryTokenFor(CronJobEntity)),
            (key: string, ttlInMs: number, run: () => Promise<void>) => this.runExecution(key, ttlInMs, run)
        );
        this.cronJobs.push(cronJob);
        // the two steps run together here, unlike at boot: this is called by an application that is
        // already up, so there is nothing left to wait for
        await cronJob.start();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async applyStoredChanges(): Promise<void> {
        // a job keeping no row has no other instance to hear from, only its own cooldown
        for (const job of this.cronJobs.filter(j => !j.syncsToDataSource)) {
            await job.restartAfterCooldown();
        }
        const synced: CronJob[] = this.cronJobs.filter(j => j.syncsToDataSource);
        if (!synced.length) {
            return;
        }
        // one read for every job, rather than one per job
        const stored: CronJobEntity[] = await inject(repositoryTokenFor(CronJobEntity)).findAll({
            where: { name: { oneOf: synced.map(j => j.name) } },
            limit: 'all'
        });
        const byName: Map<string, CronJobEntity> = new Map(stored.map(row => [row.name, row]));
        for (const job of synced) {
            const row: CronJobEntity | undefined = byName.get(job.name);
            if (row != undefined) {
                await job.applyStoredChanges(row);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async enable(name: string): Promise<void> {
        const foundJob: CronJob | undefined = this.cronJobs.find(c => c.name === name);
        if (!foundJob) {
            throw new CronJobWithNameNotFoundError(name);
        }
        await foundJob.enable();
        await this.wakeOtherInstances();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async disable(name: string): Promise<void> {
        const foundJob: CronJob | undefined = this.cronJobs.find(c => c.name === name);
        if (!foundJob) {
            throw new CronJobWithNameNotFoundError(name);
        }
        await foundJob.disable();
        await this.wakeOtherInstances();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async changeCron(name: string, cron: CronExpressionString): Promise<void> {
        const foundJob: CronJob | undefined = this.cronJobs.find(c => c.name === name);
        if (!foundJob) {
            throw new CronJobWithNameNotFoundError(name);
        }
        await foundJob.changeCron(cron);
        await this.wakeOtherInstances();
    }

    /**
     * Has the other instances apply a change to the stored jobs at their next sync, however long
     * their syncs found nothing.
     */
    private async wakeOtherInstances(): Promise<void> {
        const repository: Repository<CronJobEntity, CreateCronJobEntityData> = inject(repositoryTokenFor(CronJobEntity));
        await inject(ZIBRI_DI_TOKENS.WAKE_UP_SERVICE).wake(repository.dataSource, WAKE_UP_TOPICS.CRON_JOBS);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async update(
        name: string,
        data: CronUpdateData
    ): Promise<void> {
        const foundJob: CronJob | undefined = this.cronJobs.find(c => c.name === name);
        if (!foundJob) {
            throw new CronJobWithNameNotFoundError(name);
        }
        if (data.name !== foundJob.name && this.cronJobs.filter(j => j.name === data.name).length) {
            throw new BadRequestError([
                $ts`cannot not change the cron jobs name from "${foundJob.name}" to "${data.name}":`,
                $ts`name is already taken`
            ]);
        }
        await foundJob.update(data);
        await this.wakeOtherInstances();
    }
}