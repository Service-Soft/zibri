import { HashString } from './hash.utilities.ts';
import { HashStrategyInterface } from './strategies/hash-strategy.interface.ts';
import { AnyObject } from '../../entity/any-object.model.ts';
import { Newable } from '../../types/newable.type.ts';

/**
 * Options for hashing a value.
 */
export type HashOptions<THashOptions extends AnyObject> = {
    /**
     * The strategy to use.
     */
    strategy: Newable<HashStrategyInterface<THashOptions>>,
    /**
     * Options for the strategy.
     */
    strategyOptions?: THashOptions
};

/**
 * Interface for a hash service.
 */
export interface HashServiceInterface {
    /**
     * Hashes the given value with the given options.
     */
    hash: <THashOptions extends AnyObject>(
        value: string,
        options?: HashOptions<THashOptions>
    ) => HashString | Promise<HashString>,
    /**
     * Checks whether or not the given value equals the given hash.
     */
    equal: (value: string, hash: HashString) => boolean | Promise<boolean>,
    /**
     * Checks if the given hash should be rehashed.
     *
     * True when the strategy that produced it is marked deprecated, or when the strategy itself says
     * the hash was made more cheaply than it now would be. Acting on it needs the plaintext, so the
     * only moment it can be answered is a successful login.
     */
    needsRehash: (hash: HashString) => boolean | Promise<boolean>,
    /**
     * Whether the given string is already a hash produced by one of the registered strategies.
     *
     * Used to catch a value being hashed twice. A read-modify-write that loads an entity and saves
     * it back would otherwise hash the stored hash, which cannot be undone and locks the account.
     */
    isHash: (value: string) => boolean
}