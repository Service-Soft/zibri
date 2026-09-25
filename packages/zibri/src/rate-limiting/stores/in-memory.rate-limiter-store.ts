import { BaseRateLimitState, RateLimiterStoreInterface, RateLimiterStoreUpdateResult } from './rate-limiter-store.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';

/**
 * How many keys an in memory store holds at most.
 *
 * Sized so that reaching it means something is wrong rather than something is busy: a key space this
 * large does not come from real callers, it comes from keying on something unbounded or from having
 * outgrown a per instance store.
 */
const defaultMaxKeys: number = 100_000;

/**
 * Options for the in memory rate limiter store.
 */
export type InMemoryRateLimiterStoreOptions = {
    /**
     * How many keys this store holds at most.
     *
     * Once it is full, a key it has never seen is refused rather than added, which the limiter turns
     * into whatever its `onStoreFailure` says. Keys already in the store keep counting normally, so
     * what a full store costs is one limited endpoint rather than the process it runs in. Reaching it
     * is also reported once as an error, because it is a symptom: either the limiter keys on
     * something with no natural bound, or the app has outgrown a store that lives inside one process
     * and wants a shared one.
     */
    maxKeys?: number
};

/**
 * In-memory implementation of RateLimiterStoreInterface.
 *
 * Atomicity is guaranteed by JS's single-threaded event loop — as long as
 * the `updater` passed to atomicUpdate contains no `await` calls,
 * no two concurrent invocations can interleave.
 *
 * Expired entries are evicted lazily on the next access for their key, and in bulk by the rate
 * limiting cleanup cron job. Both are needed: the lazy path is what makes a read correct, the bulk
 * path is what keeps a key nobody comes back to from staying in memory forever.
 */
export class InMemoryRateLimiterStore<TState extends BaseRateLimitState> implements RateLimiterStoreInterface<TState> {
    private readonly internalEntries: Map<string, TState> = new Map();

    private readonly maxKeys: number;

    /**
     * Whether the size limit has already been reported, so that crossing it costs one log line rather
     * than one per request for as long as it stays crossed.
     */
    private reportedMaxKeys: boolean = false;

    constructor(options: InMemoryRateLimiterStoreOptions = {}) {
        this.maxKeys = options.maxKeys ?? defaultMaxKeys;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    atomicUpdate(
        key: string,
        updater: (current: TState | undefined) => TState
    ): RateLimiterStoreUpdateResult<TState> {
        const now: number = Date.now();
        const entry: TState | undefined = this.internalEntries.get(key);

        // an expired entry still occupies its slot, so writing over it needs no room of its own
        if (entry === undefined) {
            this.claimRoomForNewKey(now);
        }

        const current: TState | undefined = entry !== undefined && (entry.expiresAtMs > now)
            ? entry
            : undefined;

        const nextState: TState = updater(current);

        this.internalEntries.set(key, nextState);

        return {
            value: nextState,
            sizeChanged: current === undefined
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    delete(key: string): void {
        this.internalEntries.delete(key);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    deleteExpired(now: number): void {
        for (const [key, state] of this.internalEntries) {
            if (state.expiresAtMs <= now) {
                this.internalEntries.delete(key);
            }
        }
        // strictly below, because sitting exactly on the limit is what being full means - saying so
        // again once it drops back would otherwise take a single expiry
        if (this.internalEntries.size < this.maxKeys) {
            this.reportedMaxKeys = false;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    keysWithExpiredReservations(now: number): string[] {
        const res: string[] = [];
        for (const [key, state] of this.internalEntries) {
            if (state.reservations.some(r => r.expiresAtMs <= now)) {
                res.push(key);
            }
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    size(): number {
        return this.internalEntries.size;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    get(key: string): TState | undefined {
        const entry: TState | undefined = this.internalEntries.get(key);
        if (!entry || entry.expiresAtMs <= Date.now()) {
            return undefined;
        }
        return entry;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getAll(): TState[] {
        return [...this.internalEntries.values()];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    keys(): string[] {
        return [...this.internalEntries.keys()];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    entries(): Map<string, TState> {
        return this.internalEntries;
    }

    /**
     * Makes sure there is room for a key this store has never seen, and refuses when there is not.
     *
     * Refusing is deliberately not the same as evicting. Evicting resets the counter of whoever was
     * dropped, so the caller who filled the store gets everyone else's limit lifted for them - the
     * limit stays on paper and stops applying in fact. Refusing keeps every key already being counted
     * exact and costs the one endpoint whose limiter is full, which is a far smaller thing to lose
     * than the process that would otherwise run out of memory.
     * @param now - The current time (ms since epoch).
     * @throws When the store is full, which the limiter turns into whatever its `onStoreFailure` says.
     */
    private claimRoomForNewKey(now: number): void {
        if (this.internalEntries.size < this.maxKeys) {
            return;
        }
        // a store full of keys that have already expired is not actually full
        this.deleteExpired(now);
        if (this.internalEntries.size < this.maxKeys) {
            return;
        }

        if (!this.reportedMaxKeys) {
            this.reportedMaxKeys = true;
            inject(ZIBRI_DI_TOKENS.LOGGER).error(new InternalError([
                `An in memory rate limiter store is full at ${this.maxKeys} keys and is refusing new ones.`,
                'Either the limiter is keyed on something with no natural bound, or this app has outgrown',
                'a store that lives inside a single process and wants a shared one.'
            ]));
        }
        throw new InternalError(`The in memory rate limiter store is full at ${this.maxKeys} keys.`);
    }
}