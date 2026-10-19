import { type ApiKeyServiceInterface } from './api-key-service.interface';
import { CronExpression } from '../../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../../cron/cron-job.model';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';

/**
 * Deletes the api keys that expired longer ago than `deleteExpiredAfterMs` of `API_KEY_OPTIONS`.
 */
export class ApiKeyCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Cleanup expired api keys',
        cron: CronExpression.every(1, 'hours').build(),
        runOnInit: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.API_KEY_SERVICE)
        private readonly apiKeyService: ApiKeyServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.apiKeyService.deleteExpired();
    }
}