import { Log } from './log.model';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Repository } from '../data-source/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { inject } from '../di/inject.function';

/**
 * CronJob that cleans up the temp folder of the form data body parser.
 */
@Injectable()
export class LogCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Log Cleanup',
        cron: '0 0 * * *',
        runOnInit: false
    };

    private readonly logRepository: Repository<Log>;

    constructor() {
        super();
        this.logRepository = inject(repositoryTokenFor(Log));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.logger.info('cleans up expired logs');
        await this.logRepository.deleteAll({ cleanupAt: { before: new Date() } });
    }
}