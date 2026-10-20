import { JwtRevokedAccessToken } from './jwt-revoked-access-token.model.ts';
import { CronExpression } from '../../../cron/cron-expression.utilities.ts';
import { CronJob, InitialCronConfig } from '../../../cron/cron-job.model.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator.ts';

/**
 * A cron job to clean up revoked access tokens that have expired anyway.
 */
export class JwtRevokedAccessTokenCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Cleanup revoked jwt access tokens',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    constructor(
        @InjectRepository(JwtRevokedAccessToken)
        private readonly revokedAccessTokenRepository: Repository<JwtRevokedAccessToken>
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onTick(): Promise<void> {
        await this.revokedAccessTokenRepository.deleteAll({ expirationDate: { before: new Date() } });
    }
}