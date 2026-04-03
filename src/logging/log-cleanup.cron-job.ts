import { Log } from './log.model';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Repository } from '../data-source/repository';
import { InjectRepository } from '../di/decorators/inject-repository.decorator';

/**
 * CronJob that cleans up the temp folder of the form data body parser.
 */
export class LogCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Log Cleanup',
        cron: '0 0 * * *',
        runOnInit: false
    };

    constructor(
        @InjectRepository(Log)
        private readonly logRepository: Repository<Log>
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.logger.info('cleans up expired logs');
        await this.logRepository.deleteAll({ cleanupAt: { before: new Date() } });
    }
}