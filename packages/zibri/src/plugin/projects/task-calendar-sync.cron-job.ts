import { CronExpression } from '../../cron/cron-expression.utilities';
import { InitialCronConfig } from '../../cron/cron-job.model';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { QueuePollCronJob } from '../../queue/queue-poll.cron-job';
import { Newable } from '../../types/newable.type';
import { TaskCalendarSyncRequest } from './models/task-calendar-sync-request.model';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from './projects.tokens';

/**
 * Writes the due dates of tasks into the calendars of their projects as they change, and again after a failed attempt,
 * such as while the server of a calendar cannot be reached. Registered for you by `ZibriProjectsPlugin` when it syncs
 * calendars.
 */
export class TaskCalendarSyncCronJob extends QueuePollCronJob {
    /**
     * The topic a queued request wakes the poll with.
     */
    static readonly WAKE_UP_TOPIC: string = 'project-calendar-sync';

    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'sync project calendars',
        cron: CronExpression.every(5, 'seconds').build(),
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly wakeUpTopic: string = TaskCalendarSyncCronJob.WAKE_UP_TOPIC;

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly polledEntity: Newable<BaseEntity> = TaskCalendarSyncRequest;

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async runPass(): Promise<boolean> {
        // read when used rather than injected, for the reason ApprovalRequestExpiryCronJob reads its service so
        return await inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.TASK_CALENDAR_SYNC_SERVICE).syncDueRequests();
    }
}
