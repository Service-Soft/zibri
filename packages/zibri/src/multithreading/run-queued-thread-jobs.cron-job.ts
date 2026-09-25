import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { type MultithreadingServiceInterface } from './services/multithreading-service.interface';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';

/**
 * Looks for queued thread jobs this instance could be running.
 *
 * The queue is a table, so a job queued on one instance can be run by any of them - which is the
 * point, and also the reason this exists. An instance only finds out that another one queued
 * something by looking, and it only finds out that an instance holding a job has stopped existing by
 * looking again once that job's claim has lapsed.
 *
 * The instance that queues a job starts it itself where it can, so this is not the path work
 * normally arrives on. It is the path work arrives on when the instance that queued it had nothing
 * free, and when the instance that was running it is gone.
 *
 * Deliberately `distributed: false`. Every instance has its own workers to keep busy, so every one
 * of them has to look; electing a single instance would have it poll on behalf of a pool it cannot
 * reach.
 */
export class RunQueuedThreadJobsCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'run queued thread jobs',
        cron: CronExpression.every(2, 'seconds').build(),
        runOnInit: false,
        distributed: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE)
        private readonly multithreadingService: MultithreadingServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.multithreadingService.startQueuedJobs();
    }
}