import { DiToken } from './di-token.model';
import { DiVariant } from './di-variant.model';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';

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
 * How long an injected value lives.
 *
 * | | |
 * |---|---|
 * | `'application'` | built once and kept for the lifetime of the application. The default. |
 * | `'request'` | built once per request and kept for as long as that request is handled. |
 * | `'transient'` | built again on every injection, and kept by nothing. |
 */
export type DiScope = 'application' | 'request' | 'transient';

/**
 * A DI provider.
 */
export type DiProvider<T> = ClassDiProvider<T>
    | FactoryDiProvider<T>
    | AsyncFactoryDiProvider<T>
    | ValueDiProvider<T>;

/**
 * A DiProvider without its token.
 */
export type DiProviderWithoutToken<T> = OmitStrict<ClassDiProvider<T>, 'token'>
    | OmitStrict<FactoryDiProvider<T>, 'token'>
    | OmitStrict<AsyncFactoryDiProvider<T>, 'token'>
    | OmitStrict<ValueDiProvider<T>, 'token'>;

// eslint-disable-next-line jsdoc/require-jsdoc
type BaseDiProvider<T> = {
    /**
     * The token under which the value should be registered.
     */
    token: DiToken<T>,
    /**
     * The variants of the injectable.
     */
    variants?: DiVariant[]
};

// eslint-disable-next-line jsdoc/require-jsdoc
type ClassDiProvider<T> = BaseDiProvider<T> & {
    /**
     * A class to register for the token.
     */
    useClass: Newable<NoInfer<T>>,
    /**
     * How long an instance lives, and therefore when a new one is built.
     *
     * Defaults to 'application'.
     */
    scope?: DiScope,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useFactory?: never,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useAsyncFactory?: never,
    // eslint-disable-next-line jsdoc/require-jsdoc
    deps?: never,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useValue?: never
};

// eslint-disable-next-line jsdoc/require-jsdoc
type FactoryDiProvider<T> = BaseDiProvider<T> & {
    /**
     * A factory function that resolves the value to register for the token.
     *
     * Whatever it returns is the value, a promise included - use `useAsyncFactory` for a value that
     * has to be awaited before it exists. It is called with no arguments: reach for what it needs
     * with `inject()`.
     */
    useFactory: () => NoInfer<T>,
    /**
     * How long the result lives, and therefore when the factory runs again.
     *
     * Defaults to 'application'.
     */
    scope?: DiScope,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useAsyncFactory?: never,
    // eslint-disable-next-line jsdoc/require-jsdoc
    deps?: never,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useClass?: never,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useValue?: never
};

// eslint-disable-next-line jsdoc/require-jsdoc
type AsyncFactoryDiProvider<T> = BaseDiProvider<T> & {
    /**
     * A factory function that is awaited once, while the application initializes, to resolve the
     * value to register for the token.
     *
     * A connection, a secret read from a vault or a warmed cache is expressible as a provider this
     * way rather than as a lifecycle hook. Everything injected afterwards gets the value it resolved
     * to, which is what lets `inject()` stay synchronous.
     *
     * Whatever it needs arrives as an argument, in the order `deps` names it. `inject()` is refused
     * inside here: this runs before the rest of the application exists, so what `inject()` found
     * would depend on what happened to have been built already.
     *
     * Separate from `useFactory` because a promise is a value like any other: a `useFactory` that
     * returns one provides the promise itself, and only what is declared here is waited for.
     */
    useAsyncFactory: (...deps: never[]) => Promise<NoInfer<T>>,
    /**
     * What the factory needs, resolved before it runs and passed to it in this order.
     *
     * The container awaits whatever among them is itself asynchronous, and follows the constructor
     * parameters of whatever is a class - so the order these are registered in never matters, and
     * two of them needing each other is something it can name rather than something that hangs.
     */
    deps?: DiToken<unknown>[],
    /**
     * A value that is built once, before anything may ask for it, is the only one that can be
     * awaited - so this provider has no scope to choose.
     */
    scope?: 'application',
    // eslint-disable-next-line jsdoc/require-jsdoc
    useFactory?: never,
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
    // a value that already exists has nothing to build, so there is no point at which a scope
    // could give it a second life
    // eslint-disable-next-line jsdoc/require-jsdoc
    scope?: never,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useFactory?: never,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useAsyncFactory?: never,
    // eslint-disable-next-line jsdoc/require-jsdoc
    deps?: never,
    // eslint-disable-next-line jsdoc/require-jsdoc
    useClass?: never
};