import { CronExpressionString } from './cron-expression.utilities';
import { CronJob } from './cron-job.model';
import { CronUpdateData } from './cron.service';
import { RunExecution } from './run-execution.type';

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
     * Runs the given scheduled execution if this instance is the one that runs it, holding the claim
     * on it for as long as the run lasts.
     *
     * Replace the cron service to elect differently, eg. Through a lock the rest of your
     * infrastructure already has. Running nowhere stops the job running at all; running everywhere
     * is the unsafe behavior this exists to prevent.
     */
    runExecution: RunExecution
}