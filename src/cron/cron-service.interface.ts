import { Newable } from '../types';
import { CronJob } from './cron-job.model';
import { CronUpdateData } from './cron.service';

export interface CronServiceInterface {
    readonly cronJobs: CronJob[],
    init: (cronJobs: Newable<CronJob>[]) => Promise<void>,
    schedule: (cronJob: CronJob) => Promise<void>,
    enable: (name: string) => Promise<void>,
    disable: (name: string) => Promise<void>,
    changeCron: (name: string, cron: string) => Promise<void>,
    update: (name: string, data: CronUpdateData) => Promise<void>
}