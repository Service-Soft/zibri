import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';

/**
 * Result for updating an entry of the rate limiter store.
 */
export type RateLimiterStoreUpdateResult<T> = {
    /**
     * The state value.
     */
    value: T,
    /**
     * Whether or not the operation has changed the size (used for metrics).
     */
    sizeChanged: boolean
};

/**
 * Base state data shared by all rate limits.
 */
export type BaseRateLimitState = {
    /**
     * When this state expires.
     */
    expiresAtMs: number,
    /**
     * The reservations done on this limit.
     */
    reservations: RateLimitReservation[]
};

/**
 * Persistent storage contract for rate limiter state.
 *
 * `TState` is algorithm-specific — a token bucket stores `{ tokens, lastRefill }`,
 * a sliding window stores `{ timestamps[] }`, and so on. The store has no knowledge
 * of what the state means; it only handles reading, writing, and atomicity.
 *
 * ## Atomicity requirement
 * AtomicUpdate MUST guarantee that the read-modify-write cycle is atomic:
 * no two concurrent calls for the same key can interleave. Implementations are
 * responsible for enforcing this with the appropriate primitive:
 * - **In-memory**: JS's single-threaded event loop provides this naturally,
 * as long as there are no `await` calls inside the updater.
 * - **Valkey / Redis**: use a Lua script so the read and write happen in one
 * atomic server-side operation.
 * - **Other backends**: use transactions, compare-and-swap, or advisory locks
 * as appropriate.
 */
export interface RateLimiterStoreInterface<TState extends BaseRateLimitState> {
    /**
     * The number of elements in the store.
     */
    size: () => number | Promise<number>,

    /**
     * Atomically reads the current state for `key`, passes it to `updater`,
     * persists the returned state, and returns it.
     *
     * If no state exists yet for `key`, `undefined` is passed to `updater` so the
     * algorithm can provide its initial state inline.
     * @param key - The rate limit key (e.g. `'user:42'`, `'ip:1.2.3.4'`).
     * @param updater - Pure function: receives current state (or `null`) and
     * returns the next state. Must not have side effects or
     * perform async work — the store wraps it in an atomic operation.
     * @returns The persisted state together with metadata about the operation.
     */
    atomicUpdate: (
        key: string,
        updater: (current: TState | undefined) => TState
    ) => RateLimiterStoreUpdateResult<TState> | Promise<RateLimiterStoreUpdateResult<TState>>,

    /**
     * Deletes the stored state for `key`.
     * Primarily useful for testing and administrative reset operations.
     * @param key - The rate limit key to clear.
     */
    delete: (key: string) => void | Promise<void>,

    /**
     * Reads the current state for `key` without modifying it.
     * Returns `undefined` when no state exists.
     * Optional – implementations that can’t provide a cheap read may omit it,
     * in which case `getReadyAtMs` can fall back to a no-op atomicUpdate.
     */
    get: (key: string) => (TState | undefined) | Promise<TState | undefined>,

    /**
     * Gets all registered state data.
     */
    getAll: () => TState[] | Promise<TState[]>,

    /**
     * Returns all keys currently present in the store.
     * Used during scheduled cleanup to find keys with stale reservations.
     * Optional – when missing, reservation expiry will rely solely on
     * lazy eviction during normal operations.
     */
    keys: () => string[] | Promise<string[]>
}