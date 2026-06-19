import { DiToken } from '../../di/models/di-token.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { InternalError } from '../internal-error.model';

/**
 * An error to throw when there are tokens that are not injectable.
 */
export class MissingTokensError extends InternalError {
    constructor(context: string, tokens: DiToken<unknown>[], options: ErrorOptions) {
        const messages: string[] = [
            `Error initializing ${context}`,
            'Could not inject the following tokens:'
        ];
        for (const token of tokens) {
            messages.push(`  - ${token instanceof InjectionToken ? token.key : token.name}`);
        }
        super(messages, options);
        this.name = 'MissingTokensError';
    }
}