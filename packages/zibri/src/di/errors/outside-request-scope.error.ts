import { InternalError } from '../../error-handling/internal-error.model.ts';
import { DiToken, tokenName } from '../models/di-token.model.ts';

/**
 * An error to throw when a request scoped value is asked for while no request is being handled.
 *
 * Refused rather than answered with a value of its own, because the alternative is the bug it
 * exists to prevent: a request scoped value handed out where nothing bounds its life is one that
 * lives forever, holding whichever caller happened to create it.
 */
export class OutsideRequestScopeError extends InternalError {
    constructor(token: DiToken<unknown>, options?: ErrorOptions) {
        super(
            [
                `"${tokenName(token)}" is request scoped, and nothing is being handled right now.`,
                'It is built once per request and lives as long as that request, so there is no request here to build it for -',
                'a cron tick, a lifecycle hook, an event subscriber and a bare script all run outside of one.',
                'Give it the \'application\' scope if it does not need the request, or ask for it from code a request reaches.'
            ].join('\n'),
            options
        );
        this.name = 'OutsideRequestScopeError';
    }
}