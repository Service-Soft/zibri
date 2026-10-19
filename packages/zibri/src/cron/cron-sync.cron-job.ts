import { CronExpression } from './cron-expression.utilities';
import { CronJob, InitialCronConfig } from './cron-job.model';
import { type CronServiceInterface } from './cron-service.interface';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';

/**
 * Applies the changes other instances made to the cron jobs: a job enabled, disabled, stopped on an
 * error or rescheduled there is put on, taken off or moved on this instance's schedule as well.
 *
 * Registered for you whenever the application has cron jobs.
 */
export class CronSyncCronJob extends CronJob {
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

    constructor(
        @Inject(ZIBRI_DI_TOKENS.CRON_SERVICE)
        private readonly cronService: CronServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.cronService.applyStoredChanges();
    }
}