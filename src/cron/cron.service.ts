import { inject, ZIBRI_DI_TOKENS } from '../di';
import { LoggerInterface } from '../logging';
import { Newable, OmitStrict } from '../types';
import { CronJobEntity } from './cron-job-entity.model';
import { CronJob } from './cron-job.model';
import { CronServiceInterface } from './cron-service.interface';

export type CronUpdateData = Partial<OmitStrict<CronJobEntity, 'id' | 'cron' | 'active' | 'errorMessage' | 'lastRun'>>;

export class CronService implements CronServiceInterface {

    protected readonly logger: LoggerInterface;
    readonly cronJobs: CronJob[] = [];

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    async init(cronJobs: Newable<CronJob>[]): Promise<void> {
        if (this.cronJobs.length) {
            throw new Error('has already been initialized');
        }
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
        if (!foundJob) {
            throw new Error(`Could not find cron job with name ${name}`);
        }
        await foundJob.enable();
    }

    async disable(name: string): Promise<void> {
        const foundJob: CronJob | undefined = this.cronJobs.find(c => c.name === name);
        if (!foundJob) {
            throw new Error(`Could not find cron job with name ${name}`);
        }
        await foundJob.disable();
    }

    async changeCron(name: string, cron: string): Promise<void> {
        const foundJob: CronJob | undefined = this.cronJobs.find(c => c.name === name);
        if (!foundJob) {
            throw new Error(`Could not find cron job with name ${name}`);
        }
        await foundJob.changeCron(cron);
    }

    async update(
        name: string,
        data: CronUpdateData
    ): Promise<void> {
        const foundJob: CronJob | undefined = this.cronJobs.find(c => c.name === name);
        if (!foundJob) {
            throw new Error(`Could not find cron job with name ${name}`);
        }
        if (data.name !== foundJob.name && this.cronJobs.filter(j => j.name === data.name).length) {
            throw new Error(`cannot not change the cron jobs name from "${foundJob.name}" to "${data.name}"`);
        }
        await foundJob.update(data);
    }
}