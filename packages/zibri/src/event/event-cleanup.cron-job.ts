
import { Event, EventStatus } from './event.model';
import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Repository } from '../data-source/repository/repository';
import { InjectRepository } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { InternalError } from '../error-handling/internal-error.model';
import { type RetentionInMs } from '../types/retention-in-ms.type';

/**
 * CronJob that cleans up past events: the finished ones past their `cleanupAt`, and the failed ones
 * older than `ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS`.
 */
export class EventCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Event Cleanup',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    private readonly failedRetentionInMs: RetentionInMs;

    constructor(
        @InjectRepository(Event)
        private readonly repository: Repository<Event<unknown>>,
        @Inject(ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS)
        failedRetentionInMs: RetentionInMs | undefined
    ) {
        super();
        // registered by the event service, which refuses to start without it
        if (failedRetentionInMs == undefined) {
            throw new InternalError('EventCleanupCronJob needs ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS.');
        }
        this.failedRetentionInMs = failedRetentionInMs;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        this.logger.info('cleans up past events');

        try {
            const removed: number = await this.repository.deleteAll(
                { status: EventStatus.FINISHED, cleanupAt: { before: new Date() } },
                { acrossTenants: true }
            );
            this.logger.info(`removed ${removed} events`);
            if (this.failedRetentionInMs === 'forever') {
                return;
            }
            // counted from the emit, which no row lacks: a retention is counted in days, and the
            // attempts that end in FAILED are spread over minutes
            const removedFailed: number = await this.repository.deleteAll(
                { status: EventStatus.FAILED, createdAt: { before: new Date(Date.now() - this.failedRetentionInMs) } },
                { acrossTenants: true }
            );
            this.logger.info(`removed ${removedFailed} failed events`);
        }
        catch {
            // Do nothing
        }
    }
}