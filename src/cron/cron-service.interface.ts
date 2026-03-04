import { CronJob } from './cron-job.model';
import { CronUpdateData } from './cron.service';
import { Newable } from '../types/newable.type';

/**
 * Interface for a cron service.
 */
export interface CronServiceInterface {
    /**
     * The cron jobs that are registered.
     */
    readonly cronJobs: CronJob[],
    /**
     * Initializes all cron jobs.
     */
    init: (cronJobs: Newable<CronJob>[]) => Promise<void>,
    /**
     * Schedules the given cron job.
     */
    schedule: (cronJob: CronJob) => Promise<void>,
    /**
     * Enables the cron job with the given name.
     */
    enable: (name: string) => Promise<void>,
    /**
     * Disables the cron job with the given name.
     */
    disable: (name: string) => Promise<void>,
    /**
     * Changes the cron expression of the cron job with the given name.
     */
    changeCron: (name: string, cron: string) => Promise<void>,
    /**
     * Updates the cron job with the given name.
     */
    update: (name: string, data: CronUpdateData) => Promise<void>
}