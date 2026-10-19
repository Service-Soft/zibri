/**
 * How a cron job runs a slot again whose tick threw.
 */
export type CronRetryOptions = {
    /**
     * How many times the slot is run again after the tick that threw.
     */
    attempts: number,
    /**
     * How long to wait before the first attempt. Every attempt waits twice as long as the one before
     * it, and none starts once the next slot is due.
     */
    delayInMs: number
};