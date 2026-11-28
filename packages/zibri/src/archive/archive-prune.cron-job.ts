import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { type ArchiveServiceInterface } from './archive-service.interface';

/**
 * Deletes the rows of the archived entities whose retention ended, with their files, once a day. Listed in `cronJobs`
 * by an application that prunes its archive this way.
 */
export class ArchivePruneCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Archive Prune',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.ARCHIVE_SERVICE)
        private readonly archiveService: ArchiveServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        const removed: number = await this.archiveService.prune();
        this.logger.info(`removed ${removed} archived rows whose retention ended`);
    }
}