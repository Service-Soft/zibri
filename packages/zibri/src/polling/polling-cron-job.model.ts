import { PollPacing } from './poll-pacing.model';
import { WakeUpListener } from './wake-up-listener.model';
import { WakeUpServiceInterface } from './wake-up-service.interface';
import { CreateCronJobEntityData, CronJobEntity } from '../cron/cron-job-entity.model';
import { CronJob } from '../cron/cron-job.model';
import { RunExecution } from '../cron/run-execution.type';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { Newable } from '../types/newable.type';

/**
 * A cron job that looks for work kept in a data source, as often as there is any.
 *
 * Its schedule is how often it may look at most. While it keeps finding nothing it looks ever less
 * often, up to every `ZIBRI_DI_TOKENS.POLL_MAX_INTERVAL_IN_MS`, 30 seconds by default, and a tick it
 * skips costs nothing - not even the claim of the slot
 * of a job that runs on one instance. Whoever adds work wakes it through the
 * {@link WakeUpServiceInterface}, and it looks at its next tick again.
 *
 * Without a data source that carries messages between instances, a wake up reaches this instance only,
 * so the job looks at every tick of its schedule instead.
 */
export abstract class PollingCronJob extends CronJob {
    /**
     * The topic whoever adds work wakes this job with.
     */
    protected abstract readonly wakeUpTopic: string;

    /**
     * The entity the work is kept as, which decides the data source wake ups travel through.
     */
    protected abstract readonly polledEntity: Newable<BaseEntity>;

    private pacing: PollPacing = new PollPacing(0);

    private wakeUpListener: WakeUpListener | undefined;

    /**
     * Whether the current tick reached the poll.
     */
    private polled: boolean = false;

    /**
     * Looks for work, and does it.
     * @returns Whether it found any. A poll that did is due again at the next tick.
     */
    protected abstract poll(): Promise<boolean>;

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Whether it is time to look again. A job that looks for something besides wake ups widens this.
     */
    protected get isDue(): boolean {
        return this.pacing.isDue;
    }

    override async init(
        logger: LoggerInterface,
        repo: Repository<CronJobEntity, CreateCronJobEntityData>,
        runExecution: RunExecution
    ): Promise<void> {
        await super.init(logger, repo, runExecution);
        const dataSource: DataSourceInterface = inject(repositoryTokenFor(this.polledEntity)).dataSource;
        const wakeUpService: WakeUpServiceInterface = inject(ZIBRI_DI_TOKENS.WAKE_UP_SERVICE);
        // waiting longer while nothing is found is only safe when whoever adds work can say so
        const maxIntervalInMs: number = wakeUpService.reachesOtherInstances(dataSource)
            ? inject(ZIBRI_DI_TOKENS.POLL_MAX_INTERVAL_IN_MS)
            : 0;
        this.pacing = new PollPacing(maxIntervalInMs);
        this.wakeUpListener = await wakeUpService.listen(dataSource, this.wakeUpTopic, () => this.pacing.wake());
    }

    override async runOnTick(scheduledAt?: Date): Promise<void> {
        if (!this.isDue) {
            return;
        }
        this.polled = false;
        await super.runOnTick(scheduledAt);
        // another instance had the slot, or the job is off: either way this instance found nothing
        if (!this.polled) {
            this.pacing.recordPoll(false);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        this.polled = true;
        this.pacing.recordPoll(await this.poll());
    }

    override async shutdown(): Promise<void> {
        this.wakeUpListener?.stop();
        await super.shutdown();
    }
}