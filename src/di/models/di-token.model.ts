import { Newable } from '../../types';

/**
 * A token where DI values can be registered under.
 */
export type DiToken<T> = Newable<T> | string;