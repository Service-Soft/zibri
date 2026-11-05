import { setTimeout as wait } from 'node:timers/promises';

import { CronBackOffOptions } from './cron-back-off-options.model';
import { CronFailurePolicy } from './cron-failure-policy.model';
import { CronJobEntity, CronJobState } from './cron-job-entity.model';
import { CronRetryOptions } from './cron-retry-options.model';
import { ErrorUtilities } from '../error-handling/error.utilities';
import { type LoggerInterface } from '../logging/logger.interface';

/**
 * Decides what a cron job does when its ticks throw, as its `onFailure` asks: retry the slot, back
 * off, stop, and come back after a cooldown.
 */
export abstract class CronFailurePolicyUtilities {
    /**
     * Runs a tick, and runs it again while it throws, as often as the job's retry allows.
     * @param name - The name of the job, for the log.
     * @param retry - How the job retries, if it does.
     * @param resolveNextRuns - Finds the next slots of the job's schedule, which a retry may not reach.
     * @param resolveTickError - Runs the tick once, answering what it threw.
     * @param logger - Where a retry is logged.
     * @param signal - Ends the wait between two attempts, on shutdown.
     * @returns The error of the last attempt, or undefined once one succeeded.
     */
    static async resolveTickOutcome(
        name: string,
        retry: CronRetryOptions | undefined,
        resolveNextRuns: (count: number) => Date[],
        resolveTickError: () => Promise<unknown>,
        logger: LoggerInterface,
        signal: AbortSignal
    ): Promise<unknown> {
        let error: unknown = await resolveTickError();
        for (let attempt: number = 1; error != undefined && retry != undefined && attempt <= retry.attempts; attempt++) {
            const delayInMs: number = retry.delayInMs * (2 ** (attempt - 1));
            // a retry reaching into the next slot would run beside it, and that slot is the next
            // chance anyway. getNextRuns rather than getNextRun, which is null for a task off the
            // schedule, and a catch up run happens with the task running or not
            const [nextRun] = resolveNextRuns(1);
            if (nextRun != undefined && Date.now() + delayInMs >= nextRun.getTime()) {
                break;
            }
            logger.warn(
                `cron job "${name}" failed, running it again in ${delayInMs} ms (${attempt} of ${retry.attempts})`, { error }
            );
            try {
                await wait(delayInMs, undefined, { signal });
            }
            catch {
                // shutting down: the failure stands, and the next start is the next chance
                break;
            }
            error = await resolveTickError();
        }
        return error;
    }

    /**
     * Counts a failed tick of a job, and finds the slot it runs again when it backs off.
     * @param entity - The job's row, with the failures in a row before this one.
     * @param onFailure - What the job does when its ticks throw.
     * @param error - What the tick threw.
     * @param resolveNextRuns - Finds the next slots of the job's schedule.
     * @returns What is recorded of the failure.
     */
    static resolveFailure(
        entity: CronJobEntity,
        onFailure: CronFailurePolicy,
        error: unknown,
        resolveNextRuns: (count: number) => Date[]
    ): Pick<CronJobEntity, 'errorMessage' | 'consecutiveFailures' | 'backedOffUntil'> {
        const consecutiveFailures: number = entity.consecutiveFailures + 1;
        return {
            errorMessage: ErrorUtilities.unknownToErrorString(error),
            consecutiveFailures,
            backedOffUntil: onFailure.backOff == undefined
                ? null
                : this.resolveBackedOffUntil(onFailure.backOff, consecutiveFailures, resolveNextRuns)
        };
    }

    /**
     * Whether a job stops for the failures it had in a row.
     * @param onFailure - What the job does when its ticks throw.
     * @param consecutiveFailures - How many ticks in a row have failed.
     * @returns True when it stops.
     */
    static stopsFor(onFailure: CronFailurePolicy, consecutiveFailures: number): boolean {
        return onFailure.stopAfterFailures != undefined && consecutiveFailures >= onFailure.stopAfterFailures;
    }

    /**
     * Finds what a job its failures stopped is put back as, once its cooldown has passed since its
     * last run.
     * @param stored - The job as it is stored, or as the instance holds it when it keeps no row.
     * @param restartAfterInMs - How long the job stays stopped, if it comes back at all.
     * @returns What changes, or undefined when the job stays as it is.
     */
    static resolveRestart(
        stored: CronJobEntity,
        restartAfterInMs: number | undefined
    ): Pick<CronJobEntity, 'state' | 'previousState' | 'backedOffUntil'> | undefined {
        // its failures are still counted, so a next tick that throws stops it again at once, and one
        // that succeeds starts the count again: the job is tried once, not given its whole budget back
        if (
            stored.state !== CronJobState.STOPPED_ON_ERROR
            || restartAfterInMs == undefined
            || stored.lastRun == undefined
            || stored.lastRun.getTime() + restartAfterInMs > Date.now()
        ) {
            return undefined;
        }
        return {
            state: stored.previousState ?? CronJobState.ACTIVE,
            // the cooldown is the wait, and a back off left over from before the stop would add its own
            previousState: null,
            backedOffUntil: null
        };
    }

    /**
     * Finds the first slot a job that keeps failing runs again: after n failures in a row it skips
     * 2^n - 1 slots, up to the most its back off allows.
     * @param backOff - How the job backs off.
     * @param failures - How many ticks in a row have failed.
     * @param resolveNextRuns - Finds the next slots of the job's schedule.
     * @returns The first slot it runs again, or null when it skips none.
     */
    private static resolveBackedOffUntil(
        backOff: CronBackOffOptions,
        failures: number,
        resolveNextRuns: (count: number) => Date[]
    ): Date | null {
        const skipped: number = Math.min((2 ** failures) - 1, backOff.maxSkippedSlots);
        return skipped <= 0
            ? null
            : resolveNextRuns(skipped + 1)[skipped] ?? null;
    }
}