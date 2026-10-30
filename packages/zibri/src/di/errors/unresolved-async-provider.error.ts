import { InternalError } from '../../error-handling/internal-error.model';
import { DiToken, tokenName } from '../models/di-token.model';

/**
 * An error to throw when an asynchronous provider is injected before it has been awaited.
 *
 * `useAsyncFactory` is awaited once, while the application initializes, and what it resolved to is
 * what `inject()` hands out from then on. Whatever the initialization builds reaches it wherever it
 * asks - so what is left is a provider registered once that was over, and a value first asked for
 * inside a request is a value nothing can wait for.
 *
 * The factory is not called here: whether it has run is known from the provider alone.
 */
// that is the point of declaring that it is awaited rather than discovering it: a connection opened
// only to be thrown away with the error would be a leak on the path that reports the mistake
export class UnresolvedAsyncProviderError extends InternalError {
    constructor(
        /**
         * The token whose value has not been awaited.
         */
        readonly token: DiToken<unknown>,
        options?: ErrorOptions
    ) {
        super(
            [
                `"${tokenName(token)}" is built asynchronously and has not been awaited yet, so inject() has nothing to hand back.`,
                'Asynchronous providers are awaited while the application initializes. This one was registered after',
                'the application started awaiting them, so nothing is left to wait for it - and inject() cannot.',
                'Register it in the application\'s or a plugin\'s providers, which are in place before that starts.'
            ].join('\n'),
            options
        );
        this.name = 'UnresolvedAsyncProviderError';
    }
}