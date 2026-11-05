import { InternalError } from '../../error-handling/internal-error.model';
import { DiToken } from '../models/di-token.model';

/**
 * An error to throw when two plugins provide the same token and nothing says which one to use.
 *
 * Registering over an existing provider is not an error in itself - it is how the framework is
 * configured. A providers array is read front to back and the last entry for a token wins, so
 * `[...sharedProviders, myOverride]` means what it looks like, and the decision is written down in
 * one place where a reader can see it.
 *
 * Two plugins are not that. Neither author wrote the list their providers end up in, and the winner
 * would be whichever plugin is named first in the application's `plugins` array - an ordering nobody
 * chose as precedence and no plugin can see.
 */
export class ProviderCollisionError extends InternalError {
    constructor(token: DiToken<unknown>, firstPlugin: string, secondPlugin: string, options?: ErrorOptions) {
        super(
            [
                `The plugins "${firstPlugin}" and "${secondPlugin}" both provide "${'key' in token ? token.key : token.name}".`,
                'Neither takes precedence over the other, so which one is used would come down to the order they are listed in.',
                'Name the token in the application\'s own providers array to say which implementation to use -',
                'that array is registered after every plugin, so what it names wins over both.'
            ].join('\n'),
            options
        );
        this.name = 'ProviderCollisionError';
    }
}