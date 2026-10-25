import { CronExpression } from './cron-expression.utilities';
import { CronJobEntity } from './cron-job-entity.model';
import { InitialCronConfig } from './cron-job.model';
import { type CronServiceInterface } from './cron-service.interface';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { BaseEntity } from '../entity/base-entity.model';
import { PollingCronJob } from '../polling/polling-cron-job.model';
import { WAKE_UP_TOPICS } from '../polling/wake-up-topics';
import { Newable } from '../types/newable.type';

/**
 * Applies the changes other instances made to the cron jobs: a job enabled, disabled, stopped on an
 * error or rescheduled there is put on, taken off or moved on this instance's schedule as well.
 *
 * Registered for you whenever the application has cron jobs.
 */
export class CronSyncCronJob extends PollingCronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Cron Sync',
        cron: CronExpression.every(5, 'seconds').build(),
        runOnInit: false,
        // every instance holds a schedule of its own to bring in line, so every instance runs this,
        // as the cache invalidation job does
        distributed: false,
        // kept out of the data source, so it never applies a stored change to itself from inside its
        // own tick
        syncToDataSource: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly wakeUpTopic: string = WAKE_UP_TOPICS.CRON_JOBS;

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly polledEntity: Newable<BaseEntity> = CronJobEntity;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.CRON_SERVICE)
        private readonly cronService: CronServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async poll(): Promise<boolean> {
        await this.cronService.applyStoredChanges();
        // one read applies every change, so there is nothing to look again for until the next one
        // wakes it
        return false;
    }
}