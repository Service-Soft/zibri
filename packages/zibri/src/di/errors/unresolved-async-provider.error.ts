import { InternalError } from '../../error-handling/internal-error.model.ts';
import { DiToken, tokenName } from '../models/di-token.model.ts';

/**
 * An error to throw when an asynchronous provider is injected before it has been awaited.
 *
 * `useAsyncFactory` is awaited once, while the application initializes, and what it resolved to is
 * what `inject()` hands out from then on. That sweep reaches everything registered by the time it
 * runs, so what is left is what registers later - and a value first asked for inside a request is a
 * value nothing can wait for.
 *
 * The factory is not called here. Whether it has run is known from the provider alone, which is the
 * point of declaring that it is awaited rather than discovering it: a connection opened only to be thrown
 * away with the error would be a leak on the path that reports the mistake.
 */
export class UnresolvedAsyncProviderError extends InternalError {
    constructor(token: DiToken<unknown>, options?: ErrorOptions) {
        super(
            [
                `"${tokenName(token)}" is built asynchronously and has not been awaited yet, so inject() has nothing to hand back.`,
                'Asynchronous providers are resolved while the application initializes, which reaches everything',
                'registered by then. This one is not: it is registered with `register: \'onUse\'`, or added after',
                'initialization, so it is built the first time something asks for it - and inject() cannot wait.',
                'Register it in the application\'s providers array, where the initialization sweep finds it.'
            ].join('\n'),
            options
        );
        this.name = 'UnresolvedAsyncProviderError';
    }
}