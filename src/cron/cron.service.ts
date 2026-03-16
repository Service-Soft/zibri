import { CronJobEntity } from './cron-job-entity.model';
import { CronJob } from './cron-job.model';
import { CronServiceInterface } from './cron-service.interface';
import { ZibriApplication } from '../application';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { OnAppInit } from '../global/on-app-init.interface';
import { LoggerInterface } from '../logging/logger.interface';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * Data that can be used to update a cron job.
 */
export type CronUpdateData = Partial<OmitStrict<CronJobEntity, 'id' | 'cron' | 'active' | 'errorMessage' | 'lastRun'>>;

/**
 * Default cron service implementation of Zibri.
 */
export class CronService implements CronServiceInterface, OnAppInit {

    /**
     * A logger.
     */
    protected readonly logger: LoggerInterface;
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly cronJobs: CronJob[] = [];

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit({ options }: ZibriApplication): Promise<void> {
        const { cronJobs } = options;
        if (this.cronJobs.length) {
            throw new Error('has already been initialized');
        }
        if (cronJobs.length) {
            await this.logger.info(`registers ${cronJobs.length} ${cronJobs.length > 1 ? 'cron jobs' : 'cron job'}`);
        }
        for (const cronJobClass of cronJobs) {
            const cronJob: CronJob = inject(cronJobClass);
            await cronJob.init();
            await this.logger.info(`  -  ${cronJobClass.name} (${cronJob.active ? 'active' : 'not active'})`);
            this.cronJobs.push(cronJob);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async schedule(cronJob: CronJob): Promise<void> {
        await cronJob.init();
        this.cronJobs.push(cronJob);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async enable(name: string): Promise<void> {
        const foundJob: CronJob | undefined = this.cronJobs.find(c => c.name === name);
        if (!foundJob) {
            throw new Error(`Could not find cron job with name ${name}`);
        }
        await foundJob.enable();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async disable(name: string): Promise<void> {
        const foundJob: CronJob | undefined = this.cronJobs.find(c => c.name === name);
        if (!foundJob) {
            throw new Error(`Could not find cron job with name ${name}`);
        }
        await foundJob.disable();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async changeCron(name: string, cron: string): Promise<void> {
        const foundJob: CronJob | undefined = this.cronJobs.find(c => c.name === name);
        if (!foundJob) {
            throw new Error(`Could not find cron job with name ${name}`);
        }
        await foundJob.changeCron(cron);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
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