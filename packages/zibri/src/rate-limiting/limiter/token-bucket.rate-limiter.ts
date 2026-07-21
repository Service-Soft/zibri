
import { NumberUtilities } from '../../utilities/number.utilities';
import { RateLimitResult } from '../rate-limit-result.model';
import { BaseRateLimiter } from './base-rate-limiter.model';
import { RateLimiterConfigInput } from './rate-limiter-config.model';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { BaseRateLimitState } from '../stores/rate-limiter-store.interface';

/**
 * The persisted state for a single token bucket.
 * Tokens are stored as a float — fractional accumulation between requests
 * is what makes continuous refill work correctly.
 */
export type TokenBucketState = BaseRateLimitState & {
    /**
     * Current token count. May be fractional between refills.
     */
    readonly tokens: number,
    /**
     * Timestamp of the last refill in ms.
     */
    readonly lastRefillMs: number
};

/**
 * The result of refilling the bucket.
 */
type RefillResult = {
    /**
     * The amount of tokens after the refill .
     */
    tokens: number,
    /**
     * The timestamp at which the last refill happened (now).
     */
    lastRefillMs: number
};

/**
 * A token bucket rate limiter.
 */
export class TokenBucketRateLimiter extends BaseRateLimiter<TokenBucketState> {

    protected constructor(
        private readonly intervalInMs: number,
        config: RateLimiterConfigInput<TokenBucketState>
    ) {
        super({
            reservationGracePeriodMs: (waitMs) => Math.max(5000, waitMs),
            maxReservationCount: config.capacity,
            ...config
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async consume(key: string, count: number): Promise<RateLimitResult> {
        const now: number = Date.now();

        // These are set synchronously inside the updater before atomicUpdate resolves.
        // Safe because JS is single-threaded and the updater contains no awaits.
        let allowed: boolean = false;
        let tokensAfterOp: number = 0;

        const { sizeChanged } = await this.measureStoreOperation(
            'atomicUpdate',
            () => this.config.store.atomicUpdate(
                key,
                (current) => {
                    current ??= this.initialAlgoState(now);
                    const refilled: RefillResult = this.refill(current, now);

                    if (refilled.tokens >= count) {
                        allowed = true;
                        tokensAfterOp = refilled.tokens - count;
                    }
                    else {
                        allowed = false;
                        tokensAfterOp = refilled.tokens;
                    }

                    return {
                        ...current,
                        tokens: tokensAfterOp,
                        lastRefillMs: now,
                        // Renew idle-key expiry on every touch, same intent as the
                        // ttlMs argument the store used to take directly.
                        expiresAtMs: Math.max(current.expiresAtMs, now + this.intervalInMs)
                    };

                }
            )
        );

        if (sizeChanged) {
            void this.updateActiveKeysGauge();
        }

        // tokens can be negative here (debt from open reservations) — clamp
        // for reporting purposes, since "remaining" shouldn't go negative.
        const remaining: number = Math.max(0, Math.floor(tokensAfterOp));

        return {
            allowed,
            limit: this.config.capacity,
            remaining,
            resetsAtMs: now + Math.ceil(
                NumberUtilities.subtract(this.config.capacity, tokensAfterOp)
                    .multipliedBy(this.intervalInMs)
                    .dividedBy(this.config.capacity)
                    .toNumber()
            ),
            ...!allowed && {
                retryAtMs: now + Math.ceil(
                    NumberUtilities.subtract(count, tokensAfterOp)
                        .multipliedBy(this.intervalInMs)
                        .dividedBy(this.config.capacity)
                        .toNumber()
                )
            }
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected initialAlgoState(now: number): TokenBucketState {
        return {
            tokens: this.config.capacity,
            lastRefillMs: now,
            reservations: [],
            expiresAtMs: now + this.intervalInMs
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected debitCapacity(state: TokenBucketState, count: number): TokenBucketState {
        const now: number = Date.now();
        const refilled: RefillResult = this.refill(state, now);
        return {
            ...state,
            tokens: NumberUtilities.subtract(refilled.tokens, count).toNumber(),
            lastRefillMs: now
        };

    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected creditCapacity(state: TokenBucketState, count: number): TokenBucketState {
        const now: number = Date.now();
        const refilled: RefillResult = this.refill(state, now);
        return {
            ...state,
            tokens: Math.min(this.config.capacity, NumberUtilities.add(refilled.tokens, count).toNumber()),
            lastRefillMs: now
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected computeReadyAtMs(
        state: TokenBucketState,
        _reservations: RateLimitReservation[],
        count: number,
        now: number
    ): number {
        const refilled: RefillResult = this.refill(state, now);

        if (refilled.tokens >= count) {
            return now;
        }

        const deficit: number = NumberUtilities.subtract(count, refilled.tokens).toNumber();
        return now + Math.ceil(
            NumberUtilities.multiply(deficit, this.intervalInMs)
                .dividedBy(this.config.capacity)
                .toNumber()
        );

    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected recomputeReadyTimes(state: TokenBucketState, now: number): TokenBucketState {
        const refilled: RefillResult = this.refill(state, now);

        // refilled.tokens already excludes every reservation still in
        // state.reservations. Add their total debt back to recover the
        // "as if no reservations existed" baseline, then replay each one in
        // insertion order to derive its individual ready time again. Without this
        // step we'd double-subtract debt that's already folded into the
        // scalar `tokens` value.
        const totalOpenReservationDebt: number = state.reservations.reduce(
            (sum, r) => NumberUtilities.add(sum, r.count).toNumber(),
            0
        );
        let availableBeforeNext: number = NumberUtilities.add(refilled.tokens, totalOpenReservationDebt).toNumber();

        const updatedReservations: RateLimitReservation[] = state.reservations.map((r) => {
            const readyAtMs: number = availableBeforeNext >= r.count
                ? now
                : now + Math.ceil(
                    NumberUtilities.subtract(r.count, availableBeforeNext)
                        .multipliedBy(this.intervalInMs)
                        .dividedBy(this.config.capacity)
                        .toNumber()
                );
            availableBeforeNext = NumberUtilities.subtract(availableBeforeNext, r.count).toNumber();

            return { ...r, readyAtMs };
        });

        return {
            ...state,
            tokens: refilled.tokens,
            lastRefillMs: now,
            reservations: updatedReservations
        };
    }

    private refill(state: TokenBucketState, now: number): RefillResult {
        const elapsedMs: number = Math.max(0, NumberUtilities.subtract(now, state.lastRefillMs).toNumber());
        const refillTokens: number = NumberUtilities
            .multiply(elapsedMs, this.config.capacity)
            .dividedBy(this.intervalInMs)
            .toNumber();

        return {
            tokens: Math.min(this.config.capacity, NumberUtilities.add(state.tokens, refillTokens).toNumber()),
            lastRefillMs: now
        };
    }

}