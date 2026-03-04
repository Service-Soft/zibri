import { Ms } from '../utilities/ms';

/**
 * A rate limiter that provides an "isAvailable" method which ensures
 * that no more than the provided maximum can be used.
 */
export class RateLimiter {
    private tokens: number;
    private lastRefill: number;

    private constructor(
        private readonly max: number,
        private readonly intervalInMs: number
    ) {
        this.tokens = max;
        this.lastRefill = Date.now();
    }

    /**
     * Creates a rate limiter with the provided maximum available per day.
     * @param max - The maximum available per day.
     * @returns The RateLimiter.
     */
    static perDay(max: number): RateLimiter {
        return new this(max, Ms.DAY);
    }

    /**
     * Creates a rate limiter with the provided maximum available per hour.
     * @param max - The maximum available per hour.
     * @returns The RateLimiter.
     */
    static perHour(max: number): RateLimiter {
        return new this(max, Ms.HOUR);
    }

    /**
     * Creates a rate limiter with the provided maximum available per minute.
     * @param max - The maximum available per minute.
     * @returns The RateLimiter.
     */
    static perMinute(max: number): RateLimiter {
        return new this(max, Ms.MINUTE);
    }

    /**
     * Creates a rate limiter with the provided maximum available per second.
     * @param max - The maximum available per seconds.
     * @returns The RateLimiter.
     */
    static perSecond(max: number): RateLimiter {
        return new this(max, Ms.SECOND);
    }

    private refill(): void {
        const now: number = Date.now();
        const elapsedMs: number = now - this.lastRefill;
        if (elapsedMs <= 0) {
            return;
        }

        const refillTokens: number = (elapsedMs * this.max) / this.intervalInMs;
        this.tokens = Math.min(this.max, this.tokens + refillTokens);
        this.lastRefill = now;
    }

    /**
     * Checks whether or not the provided count of the limited resource is currently available or if it has been used up.
     * @param count - The amount of the limited resource to request.
     * @returns True when the provided count is available, false otherwise.
     */
    isAvailable(count: number): boolean {
        this.refill();
        if (this.tokens >= count) {
            this.tokens -= count;
            return true;
        }
        return false;
    }
}