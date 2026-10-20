import { CronExpressionString } from './cron-expression.utilities.ts';
import { CronJob } from './cron-job.model.ts';
import { CronUpdateData } from './cron.service.ts';
import { ShouldRunExecution } from './should-run-execution.type.ts';

/**
 * Interface for a cron service.
 */
export interface CronServiceInterface {
    /**
     * The cron jobs that are registered.
     */
    readonly cronJobs: CronJob[],
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
    changeCron: (name: string, cron: CronExpressionString) => Promise<void>,
    /**
     * Updates the cron job with the given name. Refused for a job declared in code.
     */
    update: (name: string, data: CronUpdateData) => Promise<void>,
    /**
     * Brings the schedule of this instance in line with the stored cron jobs, which other instances
     * may have enabled, disabled, stopped or rescheduled.
     */
    applyStoredChanges: () => Promise<void>,
    /**
     * Decides whether this instance is the one that runs the given scheduled execution.
     *
     * Replace the cron service to elect differently, eg. Through a lock the rest of your
     * infrastructure already has. Returning false everywhere stops the job running at all;
     * returning true everywhere is the unsafe behavior this exists to prevent.
     */
    shouldRunExecution: ShouldRunExecution
}