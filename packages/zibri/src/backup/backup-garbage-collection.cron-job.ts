import { type BackupServiceInterface } from './backup-service.interface';
import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';

/**
 * Deletes what the backup transports hold that no backup needs any more, such as the chunks only deleted
 * backups named, once a day on one instance.
 */
export class BackupGarbageCollectionCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Backup Garbage Collection',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE)
        private readonly backupService: BackupServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.backupService.collectGarbage?.();
    }
}