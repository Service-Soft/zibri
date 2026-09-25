import { CacheStoreConfig, CacheStoreInterface } from './cache-store.interface';
import { CachedValue } from './cached-value.model';
import { Bytes } from '../../utilities/bytes';
import { DoublyLinkedList, LinkedListNode } from '../../utilities/doubly-linked-list';
import { JsonUtilities } from '../../utilities/json.utilities';
import { NumberUtilities } from '../../utilities/number.utilities';
import { cacheKeyOf } from '../cache-key.function';

/**
 * Internal linked list node.
 */
interface CacheEntry<V> {
    /** The node inside the order list (holds the key). */
    orderNode: LinkedListNode<string>,
    /** The actual cached value. */
    value: CachedValue<V>,
    /** Estimated size in bytes (for byte‑based eviction). */
    byteSize: number,
    /** Frequency counter (used only by LFU). */
    frequency: number
}

/**
 * A simple in‑memory cache store.
 *
 * Supports LRU, MRU, FIFO and LFU eviction when maxEntries or maxBytes
 * are exceeded.  The implementation uses a generic {@link DoublyLinkedList}
 * to keep O(1) access, removal and reordering.
 */
export class InMemoryCacheStore<K, V> implements CacheStoreInterface<K, V> {
    // keyed by what `cacheKeyOf` makes of the key rather than by the key itself. A key provider
    // returning an object builds a new one per call, so a map keyed by reference identity would
    // never find what the previous call stored - the cache would simply never hit, silently, while
    // the valkey store holding the same declaration hits normally
    private readonly entries: Map<string, CacheEntry<V>> = new Map();

    private readonly orderList: DoublyLinkedList<string> = new DoublyLinkedList();

    private currentBytes: number = 0;

    /**
     * How many entries have been dropped for having expired since removeExpired last reported.
     *
     * A read that runs into an expired entry removes it just as the sweep would, so both count into
     * the same number - what the sweep reports is how many expired, not how many it happened to be
     * the one to find.
     */
    private expiredSinceLastReport: number = 0;

    // LFU helpers
    private readonly frequencyMap: Map<number, Set<string>> = new Map();
    private minFrequency: number = 0;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly config: CacheStoreConfig;

    constructor(configInput?: Partial<CacheStoreConfig>) {
        this.config = {
            maxEntries: 5000,
            maxBytes: Bytes.MB * 25,
            removeOnOverflow: 'leastRecentlyUsed',
            ...configInput
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    get(key: K): CachedValue<V> | undefined {
        const id: string = cacheKeyOf(key);
        const entry: CacheEntry<V> | undefined = this.entries.get(id);
        if (!entry) {
            return undefined;
        }

        // before recording the access, which is the order that matters: reading an expired entry
        // used to promote it to most recently used, so the dead entries were the ones eviction
        // protected and the live ones it removed
        if (this.hasExpired(entry)) {
            this.dropExpired(id);
            return undefined;
        }

        this.recordAccess(entry);
        return entry.value;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    set(key: K, value: CachedValue<V>): void {
        const id: string = cacheKeyOf(key);
        const existing: CacheEntry<V> | undefined = this.entries.get(id);

        if (existing) {
            this.currentBytes = NumberUtilities.subtract(this.currentBytes, existing.byteSize).toNumber();
            existing.value = value;
            existing.byteSize = this.estimateBytes(id, value);
            this.currentBytes = NumberUtilities.add(this.currentBytes, existing.byteSize).toNumber();
            this.recordAccess(existing);
            return;
        }

        const byteSize: number = this.estimateBytes(id, value);

        // Evict until there is enough space
        while (
            this.size() >= this.config.maxEntries
            || NumberUtilities.add(this.currentBytes, byteSize).comparedTo(this.config.maxBytes) === 1
        ) {
            if (this.entries.size <= 0) {
                // a single entry exceeds the cache, skip caching for it
                return;
            }
            this.evictOne();
        }

        const orderNode: LinkedListNode<string> = this.orderList.addLast(id);

        const entry: CacheEntry<V> = {
            orderNode,
            value,
            byteSize,
            frequency: 1
        };
        this.entries.set(id, entry);
        this.currentBytes = NumberUtilities.add(this.currentBytes, byteSize).toNumber();

        // LFU initialization
        if (this.config.removeOnOverflow === 'leastFrequentlyUsed') {
            this.increaseFrequency(entry);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    delete(key: K): void {
        this.deleteById(cacheKeyOf(key));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    has(key: K): boolean {
        const entry: CacheEntry<V> | undefined = this.entries.get(cacheKeyOf(key));
        return entry != undefined && !this.hasExpired(entry);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    removeExpired(): number {
        for (const [id, entry] of this.entries.entries()) {
            if (this.hasExpired(entry)) {
                this.dropExpired(id);
            }
        }

        const removed: number = this.expiredSinceLastReport;
        this.expiredSinceLastReport = 0;
        return removed;
    }

    /**
     * Whether an entry has outlived the time to live it was written with.
     * @param entry - The entry to check.
     * @returns True if the entry has expired, false while it is still valid or has no expiry at all.
     */
    private hasExpired(entry: CacheEntry<V>): boolean {
        return entry.value.expiresAt != undefined && entry.value.expiresAt.getTime() <= Date.now();
    }

    /**
     * Removes an entry that has expired and records that it did.
     * @param id - The key as {@link cacheKeyOf} resolved it.
     */
    private dropExpired(id: string): void {
        this.deleteById(id);
        this.expiredSinceLastReport++;
    }

    /**
     * Removes the entry stored under an already resolved key.
     *
     * Everything inside holds the resolved form - the order list, the frequency buckets - so eviction
     * and tag invalidation delete by it rather than resolving a key they never had.
     * @param id - The key as {@link cacheKeyOf} resolved it.
     */
    private deleteById(id: string): void {
        const entry: CacheEntry<V> | undefined = this.entries.get(id);
        if (!entry) {
            return;
        }

        // Remove from order list
        this.orderList.remove(entry.orderNode);

        // Subtract bytes
        this.currentBytes = NumberUtilities.subtract(this.currentBytes, entry.byteSize).toNumber();

        // LFU cleanup
        if (this.config.removeOnOverflow === 'leastFrequentlyUsed') {
            this.decreaseFrequency(entry);
        }

        this.entries.delete(id);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    clear(): void {
        this.entries.clear();
        this.orderList.clear();
        this.frequencyMap.clear();
        this.currentBytes = 0;
        this.minFrequency = 0;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    size(): number {
        return this.entries.size;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    invalidateTags(tags: string[]): void {
        for (const [id, entry] of this.entries.entries()) {
            if (entry.value.tags.some(t => tags.includes(t))) {
                this.deleteById(id);
            }
        }
    }

    private evictOne(): void {
        switch (this.config.removeOnOverflow) {
            case 'leastRecentlyUsed':
            case 'firstInFirstOut': {
                // Both evict the head of the order list
                if (this.orderList.head) {
                    this.deleteById(this.orderList.head.value);
                }
                break;
            }
            case 'mostRecentlyUsed': {
                // Evict the tail (most recently used)
                if (this.orderList.tail) {
                    this.deleteById(this.orderList.tail.value);
                }
                break;
            }
            case 'leastFrequentlyUsed': {
                // Remove any key from the current minimum‑frequency bucket
                const minSet: Set<string> | undefined = this.frequencyMap.get(this.minFrequency);
                if (minSet && minSet.size > 0) {
                    // eslint-disable-next-line typescript/no-non-null-assertion
                    const keyToEvict: string = minSet.values().next().value!;
                    this.deleteById(keyToEvict);
                    return;
                }
                if (this.orderList.head) {
                    this.deleteById(this.orderList.head.value);
                }
                break;
            }
        }
    }

    private recordAccess(entry: CacheEntry<V>): void {
        switch (this.config.removeOnOverflow) {
            case 'leastRecentlyUsed':
            case 'mostRecentlyUsed': {
                // Move to tail (mark as most recent)
                this.orderList.moveToTail(entry.orderNode);
                break;
            }
            case 'firstInFirstOut': {
                break;
            }
            case 'leastFrequentlyUsed': {
                // Increase frequency
                this.increaseFrequency(entry);
                break;
            }
        }
    }

    private increaseFrequency(entry: CacheEntry<V>): void {
        const oldFrequency: number = entry.frequency;
        const newFrequency: number = oldFrequency + 1;
        entry.frequency = newFrequency;

        // remove from old frequency set
        const oldSet: Set<string> | undefined = this.frequencyMap.get(oldFrequency);
        if (oldSet) {
            oldSet.delete(entry.orderNode.value);
            if (oldSet.size === 0) {
                this.frequencyMap.delete(oldFrequency);
                if (oldFrequency === this.minFrequency) {
                    // find the next min frequency
                    this.minFrequency = Math.min(...this.frequencyMap.keys());
                    if (!Number.isFinite(this.minFrequency)) {
                        this.minFrequency = 0;
                    }
                }
            }
        }

        // add to new frequency set
        if (!this.frequencyMap.has(newFrequency)) {
            this.frequencyMap.set(newFrequency, new Set());
        }
        // eslint-disable-next-line typescript/no-non-null-assertion
        this.frequencyMap.get(newFrequency)!.add(entry.orderNode.value);
        if (newFrequency < this.minFrequency || this.minFrequency === 0) {
            this.minFrequency = newFrequency;
        }
    }

    private decreaseFrequency(entry: CacheEntry<V>): void {
        const frequency: number = entry.frequency;
        const set: Set<string> | undefined = this.frequencyMap.get(frequency);
        if (!set) {
            return;
        }

        set.delete(entry.orderNode.value);
        if (set.size === 0) {
            this.frequencyMap.delete(frequency);
            if (frequency === this.minFrequency) {
                this.minFrequency = Math.min(...this.frequencyMap.keys());
                if (!Number.isFinite(this.minFrequency)) {
                    this.minFrequency = 0;
                }
            }
        }
    }

    private estimateBytes(key: string, value: CachedValue<V>): number {
        try {
            // measured rather than serialized: the size used to be found by building the whole json
            // form of the value and throwing it away again, so caching a 5 MB result cost a 5 MB
            // synchronous copy on the event loop for a number
            return JsonUtilities.byteSizeOf({ key, value });
        }
        catch {
            return 1024;
        }
    }
}