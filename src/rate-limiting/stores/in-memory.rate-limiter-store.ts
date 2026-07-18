import { BaseRateLimitState, RateLimiterStoreInterface, RateLimiterStoreUpdateResult } from './rate-limiter-store.interface';

/**
 * In-memory implementation of RateLimiterStoreInterface.
 *
 * Atomicity is guaranteed by JS's single-threaded event loop — as long as
 * the `updater` passed to atomicUpdate contains no `await` calls,
 * no two concurrent invocations can interleave.
 *
 * Expired entries are evicted lazily on the next access for their key rather
 * than on a timer, avoiding background work and memory overhead for large
 * key spaces.
 */
export class InMemoryRateLimiterStore<TState extends BaseRateLimitState> implements RateLimiterStoreInterface<TState> {
    private readonly internalEntries: Map<string, TState> = new Map();

    // eslint-disable-next-line jsdoc/require-jsdoc
    atomicUpdate(
        key: string,
        updater: (current: TState | undefined) => TState
    ): RateLimiterStoreUpdateResult<TState> {
        const now: number = Date.now();
        const entry: TState | undefined = this.internalEntries.get(key);

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
}