import { Ms } from '../../../utilities/ms';

/**
 * How long one reading of the server's clock is used before it is read again.
 */
const MAX_READING_AGE_IN_MS: number = Ms.MINUTE;

/**
 * What the server's clock said, and when on the monotonic clock of this process it said it.
 */
type ClockReading = {
    /**
     * The time on the server's clock, in milliseconds since the epoch.
     */
    serverTimeInMs: number,
    /**
     * When it was read, on `performance.now()`.
     */
    readAtInMs: number
};

/**
 * The clock of a valkey server as this process follows it: read off the server, and carried forward
 * by the time passed since.
 */
export class ValKeyClock {
    private reading: ClockReading | undefined;

    private pendingReading: Promise<ClockReading> | undefined;

    constructor(private readonly readServerTimeInMs: () => Promise<number>) {}

    /**
     * The time on the server's clock. Reads the server when the last reading is older than a minute.
     * @returns The time.
     */
    async resolveNow(): Promise<Date> {
        // the time passed is taken off the monotonic clock, so a step of the system clock of this
        // process moves nothing. A system clock drifts by a few milliseconds a minute at most, which
        // is what the age of a reading is bounded by
        const reading: ClockReading = this.reading != undefined && performance.now() - this.reading.readAtInMs < MAX_READING_AGE_IN_MS
            ? this.reading
            : await this.resolveReading();
        return new Date(reading.serverTimeInMs + (performance.now() - reading.readAtInMs));
    }

    /**
     * Reads the server's clock.
     */
    async synchronize(): Promise<void> {
        await this.resolveReading();
    }

    // once for every caller asking while a reading is underway
    private async resolveReading(): Promise<ClockReading> {
        this.pendingReading ??= this.readServerOnce();
        return await this.pendingReading;
    }

    // the reading underway, which the next caller after it settles does not wait for
    private async readServerOnce(): Promise<ClockReading> {
        try {
            return await this.readServer();
        }
        finally {
            this.pendingReading = undefined;
        }
    }

    private async readServer(): Promise<ClockReading> {
        const sentAtInMs: number = performance.now();
        const serverTimeInMs: number = await this.readServerTimeInMs();
        // the server read its clock somewhere between sending and answering, and halfway is where
        // the error is smallest. It is at most half the round trip, which is less than reading the
        // clock before every call was off by: that time was a round trip old when the call ran
        const reading: ClockReading = { serverTimeInMs, readAtInMs: (sentAtInMs + performance.now()) / 2 };
        this.reading = reading;
        return reading;
    }
}