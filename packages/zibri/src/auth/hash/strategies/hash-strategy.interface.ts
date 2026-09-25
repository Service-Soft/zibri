import { HashString } from '../hash.utilities';

/**
 * Interface for a hash strategy.
 */
export interface HashStrategyInterface<THashOptions extends Record<string, unknown>> {
    /**
     * The name of the strategy.
     */
    name: string,
    /**
     * The version of the strategy.
     */
    version: string,
    /**
     * Whether hashing the same value twice produces the same hash.
     *
     * True means the strategy is unsalted, which makes the hashed value usable as a lookup key - a
     * token can be found by hashing what the caller presented and querying for it. It also makes the
     * strategy **unusable for anything guessable**: without a salt, equal inputs share a hash and a
     * precomputed table works, so a password hashed this way is a password in a costume.
     *
     * A deterministic strategy is therefore refused as the default strategy. It has to be asked for
     * per property, by a property whose value carries its own entropy.
     */
    deterministic: boolean,
    /**
     * Hashes the given value with the given options.
     */
    hash: (value: string, options: THashOptions | undefined) => HashString | Promise<HashString>,
    /**
     * Checks whether or not the given value equals the given hash.
     */
    equal: (value: string, hash: HashString) => boolean | Promise<boolean>,
    /**
     * Whether this hash was produced more cheaply than this strategy currently would.
     *
     * Optional: a strategy with no tunable cost has nothing to answer. A strategy that does have one
     * should record it in the hash and compare against it here, so that raising the cost upgrades
     * accounts as they sign in instead of invalidating what is stored.
     */
    needsRehash?: (hash: HashString) => boolean,
    /**
     * Whether the value part of an envelope really is one of this strategy's hashes.
     *
     * Optional, and worth implementing: without it, anything carrying this strategy's name and
     * version is taken at its word, so a plaintext that happens to start with `name.version.` is
     * mistaken for a hash. Check the encoding, not the prefix.
     */
    isHashedValue?: (hashedValue: string) => boolean
}