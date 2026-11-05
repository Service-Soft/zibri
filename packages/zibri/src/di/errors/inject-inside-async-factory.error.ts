import { InternalError } from '../../error-handling/internal-error.model';
import { DiToken, tokenName } from '../models/di-token.model';

/**
 * An error to throw when an asynchronous provider is injected inside the factory of another one.
 *
 * Asynchronous providers are awaited one after the other, so whether the one asked for has been
 * awaited yet comes down to the order the providers were registered in. It is refused whether it has
 * or not, because the case that works is indistinguishable from the case that is one reordering away
 * from not working. Everything that is not awaited is built when it is asked for, as anywhere else.
 *
 * A factory body always runs while the application initializes, so a call that is there at all is
 * found the first time the application starts, not after a reordering.
 */
export class InjectInsideAsyncFactoryError extends InternalError {
    constructor(factoryToken: string, requestedToken: DiToken<unknown>, options?: ErrorOptions) {
        super(
            [
                `inject("${tokenName(requestedToken)}") was called inside the factory for "${factoryToken}".`,
                `"${tokenName(requestedToken)}" is built asynchronously too, and whether it has been awaited by then`,
                'depends on the order things are registered in.',
                `Name "${tokenName(requestedToken)}" in that provider's deps instead. The container resolves those first,`,
                'awaiting whatever among them has to be awaited, and passes them to the factory as arguments.'
            ].join('\n'),
            options
        );
        this.name = 'InjectInsideAsyncFactoryError';
    }
}