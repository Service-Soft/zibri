import { CacheStoreConfig, CacheStoreInterface } from './cache-store.interface';
import { CachedValue } from './cached-value.model';
import { Bytes } from '../../utilities/bytes';
import { DoublyLinkedList, LinkedListNode } from '../../utilities/doubly-linked-list';
import { JsonUtilities } from '../../utilities/json.utilities';
import { NumberUtilities } from '../../utilities/number.utilities';

/**
 * Internal linked list node.
 */
interface CacheEntry<K, V> {
    /** The node inside the order list (holds the key). */
    orderNode: LinkedListNode<K>,
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
    private readonly entries: Map<K, CacheEntry<K, V>> = new Map();

    private readonly orderList: DoublyLinkedList<K> = new DoublyLinkedList();

    private currentBytes: number = 0;

    // LFU helpers
    private readonly frequencyMap: Map<number, Set<K>> = new Map();
    private minFrequency: number = 0;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly config: CacheStoreConfig;

    constructor(configInput?: Partial<CacheStoreConfig>) {
        this.config = {
            maxEntries: 500,
            maxBytes: Bytes.KB * 750,
            removeOnOverflow: 'leastRecentlyUsed',
            ...configInput
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    get(key: K): CachedValue<V> | undefined {
        const entry: CacheEntry<K, V> | undefined = this.entries.get(key);
        if (!entry) {
            return undefined;
        }

        this.recordAccess(entry);
        return entry.value;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    set(key: K, value: CachedValue<V>): void {
        const existing: CacheEntry<K, V> | undefined = this.entries.get(key);

        if (existing) {
            this.currentBytes = NumberUtilities.subtract(this.currentBytes, existing.byteSize).toNumber();
            existing.value = value;
            existing.byteSize = this.estimateBytes(key, value);
            this.currentBytes = NumberUtilities.add(this.currentBytes, existing.byteSize).toNumber();
            this.recordAccess(existing);
            return;
        }

        const byteSize: number = this.estimateBytes(key, value);

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

        const orderNode: LinkedListNode<K> = this.orderList.addLast(key);

        const entry: CacheEntry<K, V> = {
            orderNode,
            value,
            byteSize,
            frequency: 1
        };
        this.entries.set(key, entry);
        this.currentBytes = NumberUtilities.add(this.currentBytes, byteSize).toNumber();

        // LFU initialization
        if (this.config.removeOnOverflow === 'leastFrequentlyUsed') {
            this.increaseFrequency(entry);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    delete(key: K): void {
        const entry: CacheEntry<K, V> | undefined = this.entries.get(key);
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

        this.entries.delete(key);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    has(key: K): boolean {
        return this.entries.has(key);
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
        for (const [key, entry] of this.entries.entries()) {
            if (entry.value.tags.some(t => tags.includes(t))) {
                this.delete(key);
            }
        }
    }

    private evictOne(): void {
        switch (this.config.removeOnOverflow) {
            case 'leastRecentlyUsed':
            case 'firstInFirstOut': {
                // Both evict the head of the order list
                if (this.orderList.head) {
                    this.delete(this.orderList.head.value);
                }
                break;
            }
            case 'mostRecentlyUsed': {
                // Evict the tail (most recently used)
                if (this.orderList.tail) {
                    this.delete(this.orderList.tail.value);
                }
                break;
            }
            case 'leastFrequentlyUsed': {
                // Remove any key from the current minimum‑frequency bucket
                const minSet: Set<K> | undefined = this.frequencyMap.get(this.minFrequency);
                if (minSet && minSet.size > 0) {
                    // eslint-disable-next-line typescript/no-non-null-assertion
                    const keyToEvict: K = minSet.values().next().value!;
                    this.delete(keyToEvict);
                    return;
                }
                if (this.orderList.head) {
                    this.delete(this.orderList.head.value);
                }
                break;
            }
        }
    }

    private recordAccess(entry: CacheEntry<K, V>): void {
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

    private increaseFrequency(entry: CacheEntry<K, V>): void {
        const oldFrequency: number = entry.frequency;
        const newFrequency: number = oldFrequency + 1;
        entry.frequency = newFrequency;

        // remove from old frequency set
        const oldSet: Set<K> | undefined = this.frequencyMap.get(oldFrequency);
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

    private decreaseFrequency(entry: CacheEntry<K, V>): void {
        const frequency: number = entry.frequency;
        const set: Set<K> | undefined = this.frequencyMap.get(frequency);
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

    private estimateBytes(key: K, value: CachedValue<V>): number {
        try {
            return Buffer.byteLength(JsonUtilities.stringify({ key, value }), 'utf8');
        }
        catch {
            return 1024;
        }
    }
}