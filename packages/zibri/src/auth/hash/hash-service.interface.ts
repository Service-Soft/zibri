import { HashString } from './hash.utilities';
import { HashStrategyInterface } from './strategies/hash-strategy.interface';
import { AnyObject } from '../../entity/any-object.model';
import { Newable } from '../../types/newable.type';

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
     * Checks if the given hash should  be rehashed.
     */
    needsRehash: (hash: HashString) => boolean | Promise<boolean>
}