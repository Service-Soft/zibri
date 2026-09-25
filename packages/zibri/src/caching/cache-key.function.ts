import { JsonUtilities } from '../utilities/json.utilities';

/**
 * Marks a key that was written as json rather than taken as it was.
 *
 * A string key is stored as itself, so that a keyspace listing stays readable, and everything else
 * is serialized - which without a mark makes the number 42 and the string '42' one key. Whatever
 * marks the difference has to be something a string key would never carry itself.
 */
const SERIALIZED_KEY_MARK: string = String.fromCodePoint(0);

/**
 * Reduces whatever a key provider returned to the value everything keyed by it agrees on.
 *
 * A key function is free to return an object - `{ userId, tenantId }` is an ordinary thing to cache
 * by - and it builds a fresh one on every call. Anything comparing those by reference therefore
 * treats two calls for the same thing as two different keys, which is silent: the cache simply never
 * hits, and coalescing never coalesces.
 *
 * The one definition of key identity, so a store, a second store and the single flight map cannot
 * disagree about it.
 * @param key - The key as the key provider returned it.
 * @returns The key as everything storing it should use it.
 */
export function cacheKeyOf(key: unknown): string {
    if (typeof key === 'string') {
        return key;
    }
    return `${SERIALIZED_KEY_MARK}${JsonUtilities.stringify(canonical(key))}`;
}

/**
 * Puts a value into the one shape every equal value shares.
 *
 * Property order is not part of what an object *is*, but it is part of what `JSON.stringify` writes,
 * so `{ userId, tenantId }` and `{ tenantId, userId }` would otherwise be two keys holding one value
 * - which costs a duplicate entry and a miss that looks like a cold cache.
 *
 * **Arrays keep their order**, because theirs carries meaning: `['name', 'createdAt']` is a different
 * sort than `['createdAt', 'name']`, and a key that could not tell them apart would serve one query's
 * answer to the other. They are walked rather than sorted, so objects inside them are still put
 * straight.
 * @param value - The value to canonicalize.
 * @returns The same value, with every object in it written in one order.
 */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(entry => canonical(entry));
    }
    if (!isPlainObject(value)) {
        // a Date, a class instance, a primitive - left to the serializer, which is what decides how
        // they are written. Reordering these would mean reading properties they do not keep their
        // value in, and an empty object is what a Date would come out as
        return value;
    }
    return Object.fromEntries(
        Object.keys(value).sort()
            .map(key => [key, canonical(value[key])])
    );
}

/**
 * Whether a value is an object literal rather than something built from a class.
 * @param value - The value to check.
 * @returns True when its properties are all it is.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value == undefined) {
        return false;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}