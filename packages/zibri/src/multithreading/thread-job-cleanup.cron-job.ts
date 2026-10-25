import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { type MultithreadingServiceInterface } from './services/multithreading-service.interface';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';

/**
 * Deletes the thread jobs that are over and older than `ZIBRI_DI_TOKENS.THREAD_JOB_RETENTION_IN_MS`.
 */
export class ThreadJobCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Thread Job Cleanup',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE)
        private readonly multithreadingService: MultithreadingServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        const removed: number = await this.multithreadingService.deleteExpiredJobs();
        this.logger.info(`removed ${removed} thread jobs`);
    }
}