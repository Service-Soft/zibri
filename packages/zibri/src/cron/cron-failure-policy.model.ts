import { CronBackOffOptions } from './cron-back-off-options.model.ts';
import { CronRetryOptions } from './cron-retry-options.model.ts';

/**
 * What a cron job does when its ticks throw. Each part is off when left out, and a job leaving all of
 * them out logs the error and runs its next slot as usual.
 *
 * Failures are counted in a row, on every instance, and a tick that succeeds starts the count again.
 * A slot whose retries all failed counts once.
 */
export type CronFailurePolicy = {
    /**
     * Runs a slot whose tick threw again. Only for work that is safe to run twice.
     */
    retry?: CronRetryOptions,
    /**
     * Skips slots while the job keeps failing.
     */
    backOff?: CronBackOffOptions
} & ({
    /**
     * Takes the job off the schedule after this many failures in a row, into `STOPPED_ON_ERROR`, until
     * the next start or until `restartAfterMs` has passed.
     */
    stopAfterFailures: number,
    /**
     * Puts a job these failures stopped back on the schedule this long after its last run. A failure
     * of its next tick stops it again.
     */
    restartAfterMs?: number
} | {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    stopAfterFailures?: undefined,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    restartAfterMs?: undefined
});