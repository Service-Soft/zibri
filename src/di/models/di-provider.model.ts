import { DiToken } from './di-token.model';
import { Newable, OmitStrict } from '../../types';

/**
 * A type safe way to define providers when eg. Inside arrays.
 *
 * Does not do anything else.
 * @param provider - The provider.
 * @returns Just the given provider, without doing anything at all.
 */
export function defineProvider<T>(provider: DiProvider<T>): DiProvider<T> {
    return provider;
}

/**
 * A DI provider.
 */
export type DiProvider<T> = ClassDiProvider<T> | FactoryDiProvider<T> | ValueDiProvider<T>;

/**
 * A DiProvider without its token.
 */
export type DiProviderWithoutToken<T> = OmitStrict<ClassDiProvider<T>, 'token'>
    | OmitStrict<FactoryDiProvider<T>, 'token'>
    | OmitStrict<ValueDiProvider<T>, 'token'>;

// eslint-disable-next-line jsdoc/require-jsdoc
type BaseDiProvider<T> = {
    /**
     * The token under which the value should be registered.
     */
    token: DiToken<T>
};

// eslint-disable-next-line jsdoc/require-jsdoc
type ClassDiProvider<T> = BaseDiProvider<T> & {
    /**
     * A class to register for the token.
     */
    useClass: Newable<NoInfer<T>>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useFactory?: never,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useValue?: never
};

// eslint-disable-next-line jsdoc/require-jsdoc
type FactoryDiProvider<T> = BaseDiProvider<T> & {
    /**
     * A factory function that resolves the value to register for the token.
     */
    useFactory: (...deps: unknown[]) => NoInfer<T>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useClass?: never,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useValue?: never
};

// eslint-disable-next-line jsdoc/require-jsdoc
type ValueDiProvider<T> = BaseDiProvider<T> & {
    /**
     * A value to register for the token.
     */
    useValue: NoInfer<T>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useFactory?: never,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useClass?: never
};