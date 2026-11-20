import { CronExpression } from '../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../cron/cron-job.model';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { type TenantServiceInterface } from '../tenant-service.interface';

/**
 * Goes on with the deletions of tenants that have not finished, such as after the instance running one stopped.
 * Registered for you once `TenantDeletion` is declared.
 */
export class TenantDeletionCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Tenant Deletion',
        cron: CronExpression.every(1, 'minutes').build(),
        runOnInit: true
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.TENANT_SERVICE)
        private readonly tenantService: TenantServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.tenantService.resumeTenantDeletions?.();
    }
}