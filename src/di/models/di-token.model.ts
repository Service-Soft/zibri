import { DiProvider, DiProviderWithoutToken } from './di-provider.model';
import { InjectionToken } from './injection-token.model';
import { Newable } from '../../types';
import { ObjectUtilities } from '../../utilities';

/**
 * A token where DI values can be registered under.
 */
export type DiToken<T> = Newable<T> | InjectionToken<T>;

// eslint-disable-next-line jsdoc/require-jsdoc
type UnwrapDiToken<T>
    = T extends InjectionToken<infer U> ? U
        // eslint-disable-next-line typescript/no-explicit-any
        : T extends new (...args: any[]) => infer U ? U
            : unknown;

/**
 * A record of DI tokens.
 */
export type TokenRecord = Record<Uppercase<string>, DiToken<unknown>>;

/**
 * A record that maps the given DI tokens to a matching provider.
 */
export type DiTokenProviderRecord<Tokens extends TokenRecord> = {
    [K in keyof Tokens]: DiProviderWithoutToken<UnwrapDiToken<Tokens[K]>>;
};

/**
 * Resolves the DI providers from the given tokens and values.
 * @param tokens - The token record.
 * @param providers - The provider values matching the tokens.
 * @returns An array of the built together DI providers.
 */
export function providersFromTokenRecord<Tokens extends TokenRecord>(
    tokens: Tokens,
    providers: DiTokenProviderRecord<Tokens>
): DiProvider<unknown>[] {
    const res: DiProvider<unknown>[] = [];

    for (const k of ObjectUtilities.keys(tokens)) {
        const token: DiToken<unknown> = (tokens as TokenRecord)[k];
        res.push({ token, ...providers[k] });
    }

    return res;
}