import { PollingCronJob } from '../polling/polling-cron-job.model';

/**
 * Polls one queue: runs passes over its due rows until one finds nothing, at every tick it is due.
 */
export abstract class QueuePollCronJob extends PollingCronJob {
    /**
     * Runs one pass over the due rows of the queue, through the service that owns it, which an
     * application may have replaced.
     * @returns Whether the pass ran anything.
     */
    protected abstract runPass(): Promise<boolean>;

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async poll(): Promise<boolean> {
        let ranAny: boolean = false;
        // until a pass finds nothing, rather than one pass a tick: a backlog is worked off at once
        // instead of a page every few seconds
        while (await this.runPass()) {
            ranAny = true;
        }
        return ranAny;
    }
}
