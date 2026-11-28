import { CronExpression } from '../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../cron/cron-job.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Ms } from '../../utilities/ms';
import { RecurringTask } from './models/recurring-task.model';
import { type Task } from './models/task.model';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from './projects.tokens';

/**
 * Creates the occurrences of the recurring tasks of every tenant that are due within their lead time, once a day, and
 * once on a start after a run was missed. Registered for you by `ZibriProjectsPlugin`.
 */
export class RecurringTaskCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Recurring Tasks',
        cron: CronExpression.daily().at(30, 'minutes').build(),
        runOnInit: false,
        // a run creates whatever is due and was not created, so one run makes up for a week of them
        catchUpWithinInMs: Ms.WEEK
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        const recurringTasks: Repository<RecurringTask> = inject(repositoryTokenFor(RecurringTask));
        const tenantIds: Set<string> = new Set();
        for await (const row of recurringTasks.stream({ select: { tenantId: true }, acrossTenants: true, unscoped: true })) {
            tenantIds.add(row.tenantId);
        }
        const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        const now: Date = new Date();
        let created: number = 0;
        // one tenant after the other, in the tenant of its recurring tasks
        for (const tenantId of tenantIds) {
            // read when used rather than injected, for the reason ApprovalRequestExpiryCronJob reads its service so
            const tasks: Task[] = await tenants.runAs(
                tenantId,
                async () => await inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.RECURRING_TASK_SERVICE).createDueOccurrences(now)
            );
            created += tasks.length;
        }
        this.logger.info(`created ${created} occurrences of the recurring tasks of ${tenantIds.size} tenants`);
    }
}
