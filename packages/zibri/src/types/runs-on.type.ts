/**
 * On how many instances something runs: on one of them, or on every one, such as a cron job's
 * scheduled execution or an event subscriber's hook.
 */
export type RunsOn = 'oneInstance' | 'everyInstance';