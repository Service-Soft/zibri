import { CacheStoreConfig, CacheStoreInterface } from './cache-store.interface';
import { CachedValue } from './cached-value.model';
import { Bytes } from '../../utilities/bytes';
import { JsonUtilities } from '../../utilities/json.utilities';
import { NumberUtilities } from '../../utilities/number.utilities';

/**
 * Internal linked list node.
 */
type INode<K, V> = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    key: K,
    // eslint-disable-next-line jsdoc/require-jsdoc
    value: CachedValue<V>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    prev: INode<K, V> | undefined,
    // eslint-disable-next-line jsdoc/require-jsdoc
    next: INode<K, V> | undefined,
    // eslint-disable-next-line jsdoc/require-jsdoc
    frequency: number,
    // eslint-disable-next-line jsdoc/require-jsdoc
    byteSize: number
};

/**
 * A simple in memory cache store.
 * Uses a map internally.
 */
export class InMemoryCacheStore<K, V> implements CacheStoreInterface<K, V> {
    private readonly map: Map<K, INode<K, V>> = new Map();
    private head: INode<K, V> | undefined; // oldest (for LRU/FIFO)
    private tail: INode<K, V> | undefined; // newest (for MRU)
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
        const node: INode<K, V> | undefined = this.map.get(key);
        if (!node) {
            return undefined;
        }

        this.recordAccess(node);
        return node.value;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    set(key: K, value: CachedValue<V>): void {
        const existing: INode<K, V> | undefined = this.map.get(key);
        if (existing) {
            // Update existing entry
            this.currentBytes = NumberUtilities.subtract(this.currentBytes, existing.byteSize).toNumber();
            existing.value = value;
            existing.byteSize = this.estimateBytes(key, value);
            this.currentBytes = NumberUtilities.add(this.currentBytes, existing.byteSize).toNumber();
            this.recordAccess(existing);
            return;
        }

        const byteSize: number = this.estimateBytes(key, value);

        // Evict until both constraints are satisfied
        while (
            this.size() >= this.config.maxEntries
            || NumberUtilities.add(this.currentBytes, byteSize).comparedTo(this.config.maxBytes) === 1
        ) {
            if (this.map.size <= 0) {
                // a single entry exceeds the cache, skip caching for it
                return;
            }
            this.evictOne();
        }

        const node: INode<K, V> = {
            key,
            value,
            prev: undefined,
            next: undefined,
            frequency: 1,
            byteSize
        };
        this.map.set(key, node);
        this.addToTail(node);
        this.currentBytes = NumberUtilities.add(this.currentBytes, byteSize).toNumber();

        // LFU initialization
        if (this.config.removeOnOverflow === 'leastFrequentlyUsed') {
            this.increaseFrequency(node); // will set minFrequency if needed
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    delete(key: K): void {
        const node: INode<K, V> | undefined = this.map.get(key);
        if (!node) {
            return;
        }

        this.removeNode(node);
        this.map.delete(key);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    has(key: K): boolean {
        return this.map.has(key);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    clear(): void {
        this.map.clear();
        this.frequencyMap.clear();
        this.head = undefined;
        this.tail = undefined;
        this.currentBytes = 0;
        this.minFrequency = 0;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    size(): number {
        return this.map.size;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    invalidateTags(tags: string[]): void {
        for (const [key, node] of this.map.entries()) {
            if (node.value.tags.some(t => tags.includes(t))) {
                this.delete(key);
            }
        }
    }

    private estimateBytes(key: K, value: CachedValue<V>): number {
        try {
            return Buffer.byteLength(JsonUtilities.stringify({ key, value }), 'utf8');
        }
        catch {
            // non-serializable values — fall back to a conservative fixed estimate
            return 1024;
        }
    }

    private evictOne(): void {
        switch (this.config.removeOnOverflow) {
            case 'leastRecentlyUsed': {
                if (this.head) {
                    this.delete(this.head.key);
                }
                break;
            }
            case 'mostRecentlyUsed': {
                if (this.tail) {
                    this.delete(this.tail.key);
                }
                break;
            }
            // eslint-disable-next-line sonar/no-duplicated-branches
            case 'firstInFirstOut': {
                // Same as LRU but we never call recordAccess on get() → head remains the oldest insertion.
                // Because we still call recordAccess on set(), we must disable moving:
                // we handle FIFO specially in recordAccess.
                if (this.head) {
                    this.delete(this.head.key);
                }
                break;
            }
            case 'leastFrequentlyUsed': {
                // Remove any key from the set of minimum frequency
                const minSet: Set<K> | undefined = this.frequencyMap.get(this.minFrequency);
                if (minSet && minSet.size > 0) {
                    // eslint-disable-next-line typescript/no-non-null-assertion
                    const keyToEvict: K = minSet.values().next().value!;
                    this.delete(keyToEvict);
                    return;
                }
                if (this.head) {
                    this.delete(this.head.key);
                }
                break;
            }
        }
    }

    private addToTail(node: INode<K, V>): void {
        if (!this.tail) {
            this.head = node;
            this.tail = node;
            node.prev = undefined;
            node.next = undefined;
            return;
        }

        node.prev = this.tail;
        node.next = undefined;
        this.tail.next = node;
        this.tail = node;
    }

    private removeNode(node: INode<K, V>): void {
        this.currentBytes = NumberUtilities.subtract(this.currentBytes, node.byteSize).toNumber();
        if (node.prev) {
            node.prev.next = node.next;
        }
        else {
            this.head = node.next;
        }
        if (node.next) {
            node.next.prev = node.prev;
        }
        else {
            this.tail = node.prev;
        }

        // LFU cleanup
        if (this.config.removeOnOverflow === 'leastFrequentlyUsed') {
            this.decreaseFreq(node);
        }
    }

    private recordAccess(node: INode<K, V>): void {
        switch (this.config.removeOnOverflow) {
            case 'leastRecentlyUsed':
            case 'mostRecentlyUsed': {
                // Move to tail (mark as most recent)
                this.removeNodeFromList(node);
                this.addToTail(node);
                break;
            }
            case 'firstInFirstOut': {
                // Do not change order – keep insertion order intact
                break;
            }
            case 'leastFrequentlyUsed': {
                // Increase frequency
                this.increaseFrequency(node);
                break;
            }
        }
    }

    private increaseFrequency(node: INode<K, V>): void {
        const oldFrequency: number = node.frequency;
        const newFrequency: number = oldFrequency + 1;
        node.frequency = newFrequency;

        // remove from old frequency set
        const oldSet: Set<K> | undefined = this.frequencyMap.get(oldFrequency);
        if (oldSet) {
            oldSet.delete(node.key);
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
        this.frequencyMap.get(newFrequency)!.add(node.key);
        if (newFrequency < this.minFrequency || this.minFrequency === 0) {
            this.minFrequency = newFrequency;
        }
    }

    private decreaseFreq(node: INode<K, V>): void {
        // Called when a node is removed completely (delete, evict).
        // We don't decrease frequency; we just clean up the frequency set.
        const frequency: number = node.frequency;
        const set: Set<K> | undefined = this.frequencyMap.get(frequency);

        if (!set) {
            return;
        }

        set.delete(node.key);

        if (set.size !== 0) {
            return;
        }

        this.frequencyMap.delete(frequency);

        if (frequency !== this.minFrequency) {
            return;
        }

        this.minFrequency = Math.min(...this.frequencyMap.keys());

        if (!Number.isFinite(this.minFrequency)) {
            this.minFrequency = 0;
        }
    }

    // Small helper to remove a node from the list without deleting metadata
    private removeNodeFromList(node: INode<K, V>): void {
        if (node.prev) {
            node.prev.next = node.next;
        }
        else {
            this.head = node.next;
        }
        if (node.next) {
            node.next.prev = node.prev;
        }
        else {
            this.tail = node.prev;
        }
    }
}