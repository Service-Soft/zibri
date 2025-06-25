
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

    static perDay(max: number): RateLimiter {
        return new this(max, 86_400_000);
    }

    static perHour(max: number): RateLimiter {
        return new this(max, 3_600_000);
    }

    static perMinute(max: number): RateLimiter {
        return new this(max, 60_000);
    }

    static perSecond(max: number): RateLimiter {
        return new this(max, 1000);
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

    isAvailable(count: number): boolean {
        this.refill();
        if (this.tokens >= count) {
            this.tokens -= count;
            return true;
        }
        return false;
    }
}