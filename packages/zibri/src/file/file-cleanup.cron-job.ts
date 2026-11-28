import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { type FileServiceInterface } from './file-service.interface';

/**
 * Deletes the bytes in the file stores that no row references and that were not written for a day, such as those of
 * a transaction that was rolled back, or of a tenant that was deleted.
 */
export class FileCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'File Cleanup',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.FILE_SERVICE)
        private readonly fileService: FileServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        const removed: number = await this.fileService.deleteUnreferencedFiles();
        this.logger.info(`removed ${removed} files no row references`);
    }
}