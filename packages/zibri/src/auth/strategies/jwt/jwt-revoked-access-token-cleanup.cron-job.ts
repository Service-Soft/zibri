import { JwtRevokedAccessToken } from './jwt-revoked-access-token.model';
import { CronExpression } from '../../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../../cron/cron-job.model';
import { Repository } from '../../../data-source/repository/repository';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';

/**
 * A cron job to clean up revoked access tokens that have expired anyway.
 */
export class JwtRevokedAccessTokenCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.revokedAccessTokenRepository.deleteAll({ expirationDate: { before: new Date() } });
    }
}