import { Newable } from '../types';
import { CronJob } from './cron-job.model';

export interface CronServiceInterface {
    readonly cronJobs: CronJob[],
    init: (cronJobs: Newable<CronJob>[]) => Promise<void>,
    schedule: (cronJob: CronJob) => Promise<void>,
    enable: (name: string) => Promise<void>,
    disable: (name: string) => Promise<void>
}