import { InternalError } from '../../error-handling/internal-error.model';
import { DiToken, tokenName } from '../models/di-token.model';

/**
 * An error to throw when something that outlives a request is being built out of a request scoped
 * value.
 *
 * The value would be correct exactly once. Its holder is built one time and kept, so the first
 * request to trigger that construction leaves its value in place for every request after it -
 * silently, and as the wrong user or the wrong tenant rather than as a failure.
 */
export class CapturedRequestScopeError extends InternalError {
    constructor(token: DiToken<unknown>, holder: DiToken<unknown>, options?: ErrorOptions) {
        super(
            [
                `"${tokenName(token)}" is request scoped, and "${tokenName(holder)}" outlives the request asking for it.`,
                'Its holder is built once and kept, so it would keep the first request\'s value and answer every later request with it.',
                `Inject "${tokenName(token)}" in the method that uses it rather than in the constructor:`,
                'inject() called from a method runs inside whichever request called that method.'
            ].join('\n'),
            options
        );
        this.name = 'CapturedRequestScopeError';
    }
}