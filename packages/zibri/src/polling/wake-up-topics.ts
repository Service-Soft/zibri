/**
 * The topics the framework's own polls are woken by.
 */
export const WAKE_UP_TOPICS: {
    /**
     * An event was emitted, or is owed a run again.
     */
    EVENTS: string,
    /**
     * A thread job was queued, or handed back to the queue.
     */
    THREAD_JOBS: string,
    /**
     * A mail was queued.
     */
    EMAILS: string,
    /**
     * Cache tags were invalidated.
     */
    CACHE_INVALIDATIONS: string,
    /**
     * A cron job was enabled, disabled or rescheduled.
     */
    CRON_JOBS: string,
    /**
     * The given thread job ended.
     */
    threadJobEnded: (jobId: string) => string,
    /**
     * The grant on the given key was handed back.
     */
    leaseReleased: (key: string) => string
} = {
    EVENTS: 'events',
    THREAD_JOBS: 'thread-jobs',
    EMAILS: 'emails',
    CACHE_INVALIDATIONS: 'cache-invalidations',
    CRON_JOBS: 'cron-jobs',
    threadJobEnded: jobId => `thread-job:${jobId}`,
    leaseReleased: key => `lease:${key}`
};