import { DiToken } from '.';
import { Newable } from '../../types';

/**
 * A DI provider.
 */
export type DiProvider<T> = {
    /**
     * The token under which the value should be registered.
     */
    token: DiToken<T>,
    /**
     * A class to register for the token.
     */
    useClass?: Newable<T>,
    /**
     * A factory function that resolves the value to register for the token.
     */
    useFactory?: (...deps: unknown[]) => T
};