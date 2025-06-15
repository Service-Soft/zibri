import { inject, ZIBRI_DI_TOKENS } from '../di';
import { LoggerInterface } from '../logging';
import { Newable } from '../types';
import { CronJob } from './cron-job.model';
import { CronServiceInterface } from './cron-service.interface';

export class CronService implements CronServiceInterface {

    protected logger: LoggerInterface;
    readonly cronJobs: CronJob[] = [];

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    async init(cronJobs: Newable<CronJob>[]): Promise<void> {
        if (cronJobs.length) {
            this.logger.info('registers', cronJobs.length, cronJobs.length > 1 ? 'cron jobs' : 'cron job');
        }
        for (const cronJobClass of cronJobs) {
            const cronJob: CronJob = inject(cronJobClass);
            await cronJob.init();
            this.logger.info(`-  ${cronJobClass.name} (${cronJob.active ? 'active' : 'not active'})`);
            this.cronJobs.push(cronJob);
        }
    }

    async schedule(cronJob: CronJob): Promise<void> {
        await cronJob.init();
        this.cronJobs.push(cronJob);
    }

    async enable(name: string): Promise<void> {
        const foundJob: CronJob | undefined = this.cronJobs.find(c => c.name === name);
        await foundJob?.enable();
    }

    async disable(name: string): Promise<void> {
        const foundJob: CronJob | undefined = this.cronJobs.find(c => c.name === name);
        await foundJob?.disable();
    }
}