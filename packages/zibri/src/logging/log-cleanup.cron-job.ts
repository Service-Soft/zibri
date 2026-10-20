import { Log } from './log.model.ts';
import { CronExpression } from '../cron/cron-expression.utilities.ts';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model.ts';
import { Repository } from '../data-source/repository/repository.ts';
import { InjectRepository } from '../di/decorators/inject-repository.decorator.ts';

/**
 * CronJob that cleans up expired logs.
 */
export class LogCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Log Cleanup',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    constructor(
        @InjectRepository(Log)
        private readonly logRepository: Repository<Log>
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onTick(): Promise<void> {
        this.logger.info('cleans up expired logs');
        await this.logRepository.deleteAll({ cleanupAt: { before: new Date() } }, { acrossTenants: true });
    }
}