import { InternalError } from '../../error-handling/internal-error.model.ts';
import { DiToken, tokenName } from '../models/di-token.model.ts';

/**
 * An error to throw when `inject()` is called inside the factory of an asynchronous provider.
 *
 * Asynchronous providers are resolved before the rest of the application exists, so what `inject()`
 * finds in there is whatever happens to have been built already - which comes down to the order the
 * providers were registered in. It is refused rather than allowed to work by accident, because the
 * case that works is indistinguishable from the case that is one reordering away from not working.
 *
 * The refusal is total, which is what makes it worth having: a factory body always runs while the
 * application initializes, so a call that is there at all is found the first time the application
 * starts, not the first time some branch is taken.
 */
export class InjectInsideAsyncFactoryError extends InternalError {
    constructor(factoryToken: string, requestedToken: DiToken<unknown>, options?: ErrorOptions) {
        super(
            [
                `inject("${tokenName(requestedToken)}") was called inside the factory for "${factoryToken}".`,
                'An asynchronous provider is built before the rest of the application, so what inject() finds there',
                'is only whatever happened to be built already - it would work or not by the order things are registered in.',
                `Name "${tokenName(requestedToken)}" in that provider's deps instead. The container resolves those first,`,
                'awaiting whatever among them has to be awaited, and passes them to the factory as arguments.'
            ].join('\n'),
            options
        );
        this.name = 'InjectInsideAsyncFactoryError';
    }
}