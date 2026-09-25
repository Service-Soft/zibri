import type { GlideClient, GlideString, Script } from '@valkey/valkey-glide';

import { CacheModel } from './cache-model.model';
import { CacheStoreConfig, CacheStoreInterface } from './cache-store.interface';
import { CachedValue } from './cached-value.model';
import { ValKeyDataSource } from '../../data-source/data-sources/val-key/val-key-data-source.model';
import { valKeyGlide } from '../../data-source/data-sources/val-key/val-key-glide.function';
import { parseObject } from '../../parsing/functions/parse-object.function';
import { Newable } from '../../types/newable.type';
import { Bytes } from '../../utilities/bytes';
import { JsonUtilities } from '../../utilities/json.utilities';
import { nowInNs } from '../../utilities/now-in-ns.function';

/**
 * The number of eviction candidates that are pulled from the index in one go. Only as many of them
 * as needed are actually evicted, the chunk just keeps a store that is far over its limits from
 * needing one round trip per entry to get back under them.
 */
const EVICTION_CHUNK_SIZE: number = 50;

/**
 * The two lua scripts the store's bookkeeping needs, each once it has been built.
 */
type CacheScripts = {
    /**
     * Writes an entry and everything that has to move with it.
     */
    write?: Script,
    /**
     * Removes entries and everything that was recorded about them.
     */
    drop?: Script
};

/**
 * The scripts, once they have been built.
 *
 * Built on first use rather than at module scope, because constructing one needs the optional valkey
 * client and doing that while this file loads would make every application need that package. Kept
 * afterwards because a `Script` is hashed once and invoked by that hash from then on.
 */
const cacheScripts: CacheScripts = {};

/* eslint-disable cspell/spellchecker -- the two scripts below are written in valkey's own vocabulary */

/**
 * Writes an entry, records its size, moves the byte counter by the difference and puts the entry
 * into the eviction index and its tag sets.
 *
 * One step, because the byte counter is a read followed by a write: two instances writing the same
 * key both used to read the size it had before, both add the whole new size, and the counter was
 * then permanently too high by one entry - which makes the store evict live entries forever after,
 * with nothing to bring the number back down.
 * @returns The script.
 */
function writeEntryScript(): Script {
    return cacheScripts.write ??= new (valKeyGlide().Script)([
        'local previous = redis.call("hget", KEYS[2], KEYS[1])',
        'if ARGV[2] == "" then',
        '  redis.call("set", KEYS[1], ARGV[1])',
        'else',
        '  redis.call("set", KEYS[1], ARGV[1], "px", ARGV[2])',
        'end',
        'redis.call("hset", KEYS[2], KEYS[1], ARGV[3])',
        'redis.call("incrby", KEYS[3], ARGV[3] - (previous or 0))',
        'if ARGV[4] == "increment" then',
        '  redis.call("zincrby", KEYS[4], 1, KEYS[1])',
        'else',
        '  redis.call("zadd", KEYS[4], ARGV[5], KEYS[1])',
        'end',
        'for i = 5, #KEYS do',
        '  redis.call("sadd", KEYS[i], KEYS[1])',
        'end',
        'return 1'
    ].join('\n'));
}

/**
 * Deletes entries and takes them out of the index, the sizes hash and the byte counter.
 *
 * Reading each size inside the same step is what makes removing an entry twice harmless: the second
 * caller finds no recorded size, subtracts nothing, and the counter stays right. Two instances
 * sweeping the same shared store do exactly that.
 * @returns The script.
 */
function dropEntriesScript(): Script {
    return cacheScripts.drop ??= new (valKeyGlide().Script)([
        'local total = 0',
        'local tracked = 0',
        'for i = 4, #KEYS do',
        '  local size = redis.call("hget", KEYS[1], KEYS[i])',
        '  if size then',
        '    total = total + size',
        '    tracked = tracked + 1',
        '    redis.call("hdel", KEYS[1], KEYS[i])',
        '  end',
        '  redis.call("del", KEYS[i])',
        '  redis.call("zrem", KEYS[3], KEYS[i])',
        'end',
        'if total > 0 then',
        '  redis.call("decrby", KEYS[2], total)',
        'end',
        'return tracked'
    ].join('\n'));
}

/* eslint-enable cspell/spellchecker */

/**
 * What a {@link ValKeyCacheStore} is built with.
 *
 * `model` is required and the rest is not, because everything else here has a sensible default and
 * this does not: a store that serializes cannot read a value back without knowing what it was, and
 * a default would be a guess about somebody else's data.
 */
export type ValKeyCacheStoreConfig = Partial<CacheStoreConfig> & {
    /**
     * What this store holds. See {@link CacheModel}.
     */
    model: CacheModel
};

/**
 * A cache store that keeps its values on a valkey server, which makes the cache shared between
 * all instances of an app instead of living inside a single process.
 *
 * Next to the cached values themselves the store keeps three bookkeeping keys: a sorted set that
 * orders the entries by the configured overflow strategy, a hash with the estimated size of every
 * entry and a counter holding the sum of those sizes. They are used to evict entries once
 * maxEntries or maxBytes is exceeded.
 *
 * The counter is updated by every write instead of being summed up on demand, which keeps the
 * overflow check independent of how many entries the store holds. Writing an entry and removing one
 * each happen in a single step on the server, so the counter says the same thing no matter how many
 * instances write the same key at the same time.
 *
 * Commands that do not depend on each others result are sent concurrently, the client pipelines
 * them over its single connection so that they cost one round trip together instead of one each.
 *
 * Expiration itself is left to the server, every entry is written with the time to live that
 * results from its expiresAt. The server knows nothing about the bookkeeping keys, so an entry it
 * expires is taken out of them by whichever comes first: a read that finds the value gone, or the
 * sweep behind removeExpired.
 */
export class ValKeyCacheStore<K, V> implements CacheStoreInterface<K, V> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly config: CacheStoreConfig;

    /**
     * How many entries have been dropped for having expired since removeExpired last reported.
     *
     * A read that finds the value gone counts here just as a sweep does, because the server expiring
     * a value and a sweep finding it gone are the same event seen at two different times.
     */
    private expiredSinceLastReport: number = 0;

    /**
     * What this store holds, so that a value can be read back as what it was written as.
     */
    private readonly model: CacheModel;

    constructor(private readonly ds: ValKeyDataSource, configInput: ValKeyCacheStoreConfig) {
        const { model, ...storeConfig }: ValKeyCacheStoreConfig = configInput;
        this.model = model;
        this.config = {
            maxEntries: 15000,
            maxBytes: Bytes.MB * 30,
            removeOnOverflow: 'leastRecentlyUsed',
            ...storeConfig
        };
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The prefix that all keys of this store are stored under.
     */
    private get prefix(): string {
        return `${this.ds.keyPrefix}:cache`;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async get(key: K): Promise<CachedValue<V> | undefined> {
        const fullKey: string = this.toKey(key);

        // the access is recorded right away instead of after the value came back, which makes a hit
        // cost a single round trip. a miss takes the entry out of the index again through forget
        const [raw]: [GlideString | null, void] = await Promise.all([
            this.ds.connection.get(fullKey),
            this.recordAccess(fullKey)
        ]);

        if (raw == undefined) {
            // the value expired on the server while its bookkeeping stayed behind, so the entry is
            // taken out of the index here rather than being left to count against the budget
            this.expiredSinceLastReport += await this.drop([fullKey]);
            return undefined;
        }
        return this.toCachedValue(this.toStringValue(raw));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async set(key: K, value: CachedValue<V>): Promise<void> {
        const fullKey: string = this.toKey(key);
        const serialized: string = JsonUtilities.stringify(value);
        const ttlMs: number | undefined = this.toTtlMs(value);

        if (ttlMs != undefined && ttlMs <= 0) {
            await this.delete(key);
            return;
        }

        const byLeastFrequentlyUsed: boolean = this.config.removeOnOverflow === 'leastFrequentlyUsed';

        await this.ds.connection.invokeScript(writeEntryScript(), {
            keys: [fullKey, this.sizesKey(), this.bytesKey(), this.indexKey(), ...value.tags.map(t => this.tagKey(t))],
            args: [
                serialized,
                ttlMs == undefined ? '' : String(ttlMs),
                String(Buffer.byteLength(serialized, 'utf8')),
                byLeastFrequentlyUsed ? 'increment' : 'score',
                String(Number(nowInNs()))
            ]
        });

        await this.evictOverflow();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete(key: K): Promise<void> {
        await this.drop([this.toKey(key)]);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeExpired(): Promise<number> {
        const client: GlideClient = this.ds.connection;
        let removed: number = this.expiredSinceLastReport;
        this.expiredSinceLastReport = 0;

        // the server drops the value when its time to live runs out but knows nothing about the
        // index, the sizes hash or the byte counter - so what a sweep looks for is an index entry
        // whose value is no longer there
        let examined: number = 0;
        for (;;) {
            // eslint-disable-next-line cspell/spellchecker
            const chunk: GlideString[] = await client.zrange(
                this.indexKey(),
                { start: examined, end: examined + EVICTION_CHUNK_SIZE - 1 }
            );
            if (!chunk.length) {
                return removed;
            }

            const keys: string[] = chunk.map(k => this.toStringValue(k));

            const values: (GlideString | null)[] = await client.mget(keys);
            const gone: string[] = keys.filter((_, i) => values[i] == undefined);

            if (gone.length) {
                removed += await this.drop(gone);
            }
            // the entries that are still there stay in the index, so the window has to move past
            // them - the ones that were dropped took their positions with them
            examined += keys.length - gone.length;

            if (chunk.length < EVICTION_CHUNK_SIZE) {
                return removed;
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async clear(): Promise<void> {
        const client: GlideClient = this.ds.connection;
        const keys: string[] = await this.scanKeys(`${this.prefix}:*`);
        if (keys.length) {
            await client.del(keys);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async invalidateTags(tags: string[]): Promise<void> {
        if (!tags.length) {
            return;
        }

        const client: GlideClient = this.ds.connection;
        const tagKeys: string[] = tags.map(t => this.tagKey(t));

        // eslint-disable-next-line cspell/spellchecker
        const memberSets: Set<GlideString>[] = await Promise.all(tagKeys.map(k => client.smembers(k)));
        // an entry can carry multiple of the invalidated tags, it must only be forgotten once
        const members: string[] = [...new Set(memberSets.flatMap(s => [...s].map(m => this.toStringValue(m))))];

        await Promise.all([this.drop(members), client.del(tagKeys)]);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async size(): Promise<number> {
        // eslint-disable-next-line cspell/spellchecker
        return await this.ds.connection.zcard(this.indexKey());
    }

    /**
     * Updates the position of an entry inside the eviction index after it was read.
     *
     * A write moves it too, inside the script that performs the write.
     * @param fullKey - The key of the entry.
     */
    private async recordAccess(fullKey: string): Promise<void> {
        const client: GlideClient = this.ds.connection;

        if (this.config.removeOnOverflow === 'leastFrequentlyUsed') {
            // eslint-disable-next-line cspell/spellchecker
            await client.zincrby(this.indexKey(), 1, fullKey);
            return;
        }
        if (this.config.removeOnOverflow === 'firstInFirstOut') {
            // the insertion order must not change when an entry is only read
            return;
        }
        // eslint-disable-next-line cspell/spellchecker
        await client.zadd(this.indexKey(), { [fullKey]: Number(nowInNs()) });
    }

    /**
     * Deletes entries and takes them out of all three bookkeeping keys.
     * @param fullKeys - The keys of the entries.
     * @returns How many of them the store was still keeping bookkeeping for, which is how many
     * genuinely left rather than having been removed by somebody else already.
     */
    private async drop(fullKeys: string[]): Promise<number> {
        if (!fullKeys.length) {
            return 0;
        }

        const dropped: unknown = await this.ds.connection.invokeScript(dropEntriesScript(), {
            keys: [this.sizesKey(), this.bytesKey(), this.indexKey(), ...fullKeys]
        });
        return Number(dropped);
    }

    /**
     * Evicts entries until the store is within its configured limits again.
     */
    private async evictOverflow(): Promise<void> {
        // the usage is tracked locally from here on, so that it is only read from the server once
        let [entries, bytes]: [number, number] = await this.currentUsage();

        while (entries > this.config.maxEntries || bytes > this.config.maxBytes) {
            const candidates: string[] = await this.nextEvictionCandidates();
            if (!candidates.length) {
                return;
            }
            const sizes: number[] = await this.sizesOf(candidates);

            // the whole chunk is fetched at once, but only the part of it that is needed to get
            // back within the limits is evicted
            let evictedCount: number = 0;
            while (
                evictedCount < candidates.length
                && (entries > this.config.maxEntries || bytes > this.config.maxBytes)
            ) {
                // parallel to candidates, and zero for a key the size hash does not know
                bytes -= sizes[evictedCount] ?? 0;
                entries--;
                evictedCount++;
            }

            await this.drop(candidates.slice(0, evictedCount));
        }
    }

    /**
     * Determines the entries that should be evicted next, based on the configured strategy.
     * @returns The keys of the eviction candidates, in the order they should be evicted in.
     */
    private async nextEvictionCandidates(): Promise<string[]> {
        const client: GlideClient = this.ds.connection;
        const fromEnd: boolean = this.config.removeOnOverflow === 'mostRecentlyUsed';

        // eslint-disable-next-line cspell/spellchecker
        const res: GlideString[] = await client.zrange(
            this.indexKey(),
            fromEnd
                ? { start: -EVICTION_CHUNK_SIZE, end: -1 }
                : { start: 0, end: EVICTION_CHUNK_SIZE - 1 }
        );
        const keys: string[] = res.map(k => this.toStringValue(k));

        // the range always comes back ascending, mostRecentlyUsed has to evict the other way around
        return fromEnd ? keys.reverse() : keys;
    }

    /**
     * Reads how much the store currently holds.
     * @returns The number of entries and the number of bytes they take up.
     */
    private async currentUsage(): Promise<[number, number]> {
        const client: GlideClient = this.ds.connection;

        const [entries, bytes]: [number, GlideString | null] = await Promise.all([
            // eslint-disable-next-line cspell/spellchecker
            client.zcard(this.indexKey()),
            client.get(this.bytesKey())
        ]);

        return [entries, bytes == undefined ? 0 : Number(this.toStringValue(bytes))];
    }

    /**
     * Reads the recorded size of the given entries.
     * @param fullKeys - The keys of the entries.
     * @returns The size of every entry in bytes, entries without a recorded size count as zero.
     */
    private async sizesOf(fullKeys: string[]): Promise<number[]> {
        // eslint-disable-next-line cspell/spellchecker
        const values: (GlideString | null)[] = await this.ds.connection.hmget(this.sizesKey(), fullKeys);
        return values.map(v => v == undefined ? 0 : Number(this.toStringValue(v)));
    }

    private async scanKeys(pattern: string): Promise<string[]> {
        const client: GlideClient = this.ds.connection;
        const res: string[] = [];
        let cursor: string = '0';

        do {
            const [nextCursor, keys]: [GlideString, GlideString[]] = await client.scan(cursor, { match: pattern, count: 250 });
            cursor = this.toStringValue(nextCursor);
            res.push(...keys.map(k => this.toStringValue(k)));
        }
        while (cursor !== '0');

        return res;
    }

    /**
     * Parses a cached value back into the types it was written with.
     *
     * Json carries none of them: a `Date`, a `bigint` and an exact decimal all go out as text, and
     * text is what comes back. What says which text was which is the shape of the value, read the
     * same way a request body is read - `CachedValue` declares its own two timestamps, and `model`
     * declares what is inside it.
     * @param raw - The raw json of the cached value.
     * @returns The parsed cached value.
     */
    private toCachedValue(raw: string): CachedValue<V> {
        const parsed: CachedValue<V> = parseObject(raw, CachedValue) as CachedValue<V>;
        return { ...parsed, value: this.toStoredType(parsed.value) };
    }

    /**
     * Reads the cached value itself back into the shape the store was told it holds.
     * @param value - The value as json parsed it.
     * @returns The value with its own types restored.
     */
    private toStoredType(value: V): V {
        if (this.model === 'plain' || value == undefined) {
            return value;
        }
        // the cast is what naming a class for its declarations rather than for building one costs:
        // `parseObject` asks for something constructible while only ever reading metadata off it,
        // and a model is deliberately allowed to keep its constructor to itself
        const model: Newable<unknown> = this.model as Newable<unknown>;
        // an array is what a cached read of several rows is, and the shape declared is the shape of
        // one of them - so it is read over the items rather than over the array
        if (Array.isArray(value)) {
            return value.map(item => parseObject(item, model)) as V;
        }
        return parseObject(value, model) as V;
    }

    private toTtlMs(value: CachedValue<V>): number | undefined {
        if (value.expiresAt == undefined) {
            return undefined;
        }
        return new Date(value.expiresAt).getTime() - Date.now();
    }

    private toKey(key: K): string {
        return `${this.prefix}:entry:${typeof key === 'string' ? key : JsonUtilities.stringify(key)}`;
    }

    private indexKey(): string {
        return `${this.prefix}:index`;
    }

    private sizesKey(): string {
        return `${this.prefix}:sizes`;
    }

    private bytesKey(): string {
        return `${this.prefix}:bytes`;
    }

    private tagKey(tag: string): string {
        return `${this.prefix}:tag:${tag}`;
    }

    private toStringValue(value: GlideString): string {
        return typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
    }
}