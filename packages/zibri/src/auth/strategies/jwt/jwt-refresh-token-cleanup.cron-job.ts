import { JwtRefreshToken } from './jwt-refresh-token.model';
import { CronExpression } from '../../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../../cron/cron-job.model';
import { Repository } from '../../../data-source/repository';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';

/**
 * A cron job to cleanup expired jwt refresh tokens.
 */
export class JwtRefreshTokenCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Cleanup jwt refresh tokens',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    constructor(
        @InjectRepository(JwtRefreshToken)
        private readonly refreshTokenRepository: Repository<JwtRefreshToken>
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        // blacklisted tokens need to stay, to find out
        // if someone tries to use them a second time.
        await this.refreshTokenRepository.deleteAll({ expirationDate: { before: new Date() } });
    }
}