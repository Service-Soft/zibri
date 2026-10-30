import { BackupResourceEntity } from './backup-resource-entity.model';
import { type BackupServiceInterface } from './backup-service.interface';
import { CronExpression } from '../cron/cron-expression.utilities';
import { InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { BaseEntity } from '../entity/base-entity.model';
import { WAKE_UP_TOPICS } from '../polling/wake-up-topics';
import { QueuePollCronJob } from '../queue/queue-poll.cron-job';
import { Newable } from '../types/newable.type';

/**
 * Stores the resources of queued backups that are due on this instance: those an instance that
 * stopped left behind, and those whose retry is due.
 *
 * Runs on every instance, and the claim on each resource decides which one stores it, so a backup
 * goes on as long as any instance is there.
 */
export class RunQueuedBackupsCronJob extends QueuePollCronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Run Queued Backups',
        cron: CronExpression.every(30, 'seconds').build(),
        runOnInit: false,
        runsOn: 'everyInstance',
        syncToDataSource: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly wakeUpTopic: string = WAKE_UP_TOPICS.BACKUPS;

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly polledEntity: Newable<BaseEntity> = BackupResourceEntity;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE)
        private readonly backupService: BackupServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async runPass(): Promise<boolean> {
        return await this.backupService.runQueuedBackups();
    }
}