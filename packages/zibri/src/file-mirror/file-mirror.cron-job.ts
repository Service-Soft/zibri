import { CronExpression } from '../cron/cron-expression.utilities';
import { InitialCronConfig } from '../cron/cron-job.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { QueuePollCronJob } from '../queue/queue-poll.cron-job';
import { Newable } from '../types/newable.type';
import { FileMirrorRequest } from './file-mirror-request.model';

/**
 * Writes the files queued to mirror into their folders as they are queued, and again after a failed attempt, such
 * as while the server cannot be reached. Registered for you when the data source declares `FileMirrorRequest`.
 */
export class FileMirrorCronJob extends QueuePollCronJob {
    /**
     * The topic a queued file wakes the poll with.
     */
    static readonly WAKE_UP_TOPIC: string = 'file-mirror';

    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'mirror files',
        cron: CronExpression.every(5, 'seconds').build(),
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly wakeUpTopic: string = FileMirrorCronJob.WAKE_UP_TOPIC;

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly polledEntity: Newable<BaseEntity> = FileMirrorRequest;

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async runPass(): Promise<boolean> {
        // read when used rather than injected, for the reason ApprovalRequestExpiryCronJob reads its service so
        return await inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE).uploadDueFiles();
    }
}