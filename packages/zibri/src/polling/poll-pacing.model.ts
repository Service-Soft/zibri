import { Ms } from '../utilities/ms';

/**
 * How long a poll waits after the first one that found nothing. Each further one doubles it.
 */
const FIRST_BACKOFF_IN_MS: number = Ms.SECOND;

/**
 * Decides when an instance looks again for work nobody told it about.
 *
 * At once while it keeps finding some, and ever less often while it finds none, up to the longest
 * interval it is given. A wake up has it look at once again. Each wait is somewhere between half the
 * interval and all of it, so instances that found nothing together do not all look again together.
 */
export class PollPacing {
    private intervalInMs: number = 0;

    private dueAtMs: number = 0;

    /**
     * Starts out due.
     * @param maxIntervalInMs - The longest wait. 0 for a poll that never waits longer than its schedule.
     */
    constructor(private readonly maxIntervalInMs: number) {}

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Whether it is time to look again.
     */
    get isDue(): boolean {
        return Date.now() >= this.dueAtMs;
    }

    /**
     * Notes how a poll went.
     * @param foundWork - Whether it found anything to do.
     */
    recordPoll(foundWork: boolean): void {
        if (foundWork) {
            this.wake();
            return;
        }
        this.intervalInMs = Math.min(this.maxIntervalInMs, Math.max(FIRST_BACKOFF_IN_MS, this.intervalInMs * 2));
        this.dueAtMs = Date.now() + (this.intervalInMs * (0.5 + (Math.random() / 2)));
    }

    /**
     * Makes it time to look again, and starts the waits over.
     */
    wake(): void {
        this.intervalInMs = 0;
        this.dueAtMs = 0;
    }
}