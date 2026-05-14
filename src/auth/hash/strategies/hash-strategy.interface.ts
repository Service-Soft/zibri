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
     * Hashes the given value with the given options.
     */
    hash: (value: string, options: THashOptions | undefined) => HashString | Promise<HashString>,
    /**
     * Checks whether or not the given value equals the given hash.
     */
    equal: (value: string, hash: HashString) => boolean | Promise<boolean>
}